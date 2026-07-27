// tzmath — 时区换算的纯函数
// 单独成文件，便于直接用 node 测试（浏览器里挂到全局，node 里 module.exports）。
//
// 核心难点：把「某地的墙上时间」还原成绝对时刻。
// 同一个墙上时间在夏令时切换点可能对应两个时刻（回拨）或零个时刻（前拨），
// 必须迭代校正偏移量，不能只查一次。

(() => {
  "use strict";

  const partsCache = new Map();
  function fmt(tz, opts) {
    const key = tz + JSON.stringify(opts);
    let f = partsCache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
      partsCache.set(key, f);
    }
    return f;
  }

  // 某时刻在某时区的 UTC 偏移（毫秒）
  function offsetMs(instant, tz) {
    const p = fmt(tz, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(instant);

    const g = {};
    for (const { type, value } of p) if (type !== "literal") g[type] = value;
    // hour 在 hour12:false 下可能是 "24"，代表午夜
    const hour = g.hour === "24" ? 0 : Number(g.hour);
    const asUTC = Date.UTC(Number(g.year), Number(g.month) - 1, Number(g.day), hour, Number(g.minute), Number(g.second));
    // 抹掉毫秒再比，避免残差
    return asUTC - Math.floor(instant / 1000) * 1000;
  }

  // 墙上时间 -> 绝对时刻。迭代两次覆盖夏令时边界。
  function wallToInstant(wall, tz) {
    const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second || 0);
    let guess = naive - offsetMs(naive, tz);
    const check = offsetMs(guess, tz);
    const corrected = naive - check;
    if (corrected !== guess) {
      // 再验一次：若仍不自洽，说明落在不存在的时间里（前拨跳过的那一小时）
      if (offsetMs(corrected, tz) === check) guess = corrected;
    }
    return guess;
  }

  // 该墙上时间是否不存在（夏令时前拨跳过）
  function isGap(wall, tz) {
    const instant = wallToInstant(wall, tz);
    const back = instantToWall(instant, tz);
    return back.hour !== wall.hour || back.day !== wall.day || back.minute !== wall.minute;
  }

  // 该墙上时间是否重复出现（夏令时回拨）
  function isAmbiguous(wall, tz) {
    const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second || 0);
    const a = naive - offsetMs(naive - 86400000, tz); // 用前一天的偏移
    const b = naive - offsetMs(naive + 86400000, tz); // 用后一天的偏移
    if (a === b) return false;
    const wa = instantToWall(a, tz), wb = instantToWall(b, tz);
    const same = (w) => w.hour === wall.hour && w.minute === wall.minute && w.day === wall.day;
    return same(wa) && same(wb);
  }

  // 绝对时刻 -> 某时区的墙上时间
  function instantToWall(instant, tz) {
    const p = fmt(tz, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short", hour12: false,
    }).formatToParts(instant);
    const g = {};
    for (const { type, value } of p) if (type !== "literal") g[type] = value;
    return {
      year: Number(g.year), month: Number(g.month), day: Number(g.day),
      hour: g.hour === "24" ? 0 : Number(g.hour),
      minute: Number(g.minute), second: Number(g.second),
      weekday: g.weekday,
    };
  }

  // "GMT+08:00" 形式的偏移标签
  function offsetLabel(instant, tz) {
    const p = fmt(tz, { timeZoneName: "longOffset" }).formatToParts(instant);
    const v = p.find((x) => x.type === "timeZoneName")?.value || "";
    return v === "GMT" ? "GMT+00:00" : v;
  }

  // 时区缩写，如 EDT / CST
  function abbr(instant, tz) {
    const p = fmt(tz, { timeZoneName: "short" }).formatToParts(instant);
    return p.find((x) => x.type === "timeZoneName")?.value || "";
  }

  // 是否处于夏令时：与该年 1 月/7 月的最小偏移比较
  function isDST(instant, tz) {
    const y = instantToWall(instant, tz).year;
    const jan = offsetMs(Date.UTC(y, 0, 15), tz);
    const jul = offsetMs(Date.UTC(y, 6, 15), tz);
    if (jan === jul) return false;
    return offsetMs(instant, tz) === Math.max(jan, jul);
  }

  // 相对某个基准时区，日期差了几天（-1 昨天 / 0 同天 / +1 明天）
  function dayDelta(instant, tz, baseTz) {
    const a = instantToWall(instant, tz);
    const b = instantToWall(instant, baseTz);
    const da = Date.UTC(a.year, a.month - 1, a.day);
    const db = Date.UTC(b.year, b.month - 1, b.day);
    return Math.round((da - db) / 86400000);
  }

  const pad = (n) => String(n).padStart(2, "0");

  function fmtWall(w, withSec) {
    const t = `${pad(w.hour)}:${pad(w.minute)}` + (withSec ? `:${pad(w.second)}` : "");
    return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: t, weekday: w.weekday };
  }

  // 解析用户输入：ISO 8601 / Unix 时间戳 / 常见新闻稿写法
  function parseInput(raw) {
    const s = raw.trim();
    if (!s) return null;

    // 纯数字：Unix 时间戳（10 位秒 / 13 位毫秒）
    if (/^\d{9,14}$/.test(s)) {
      const n = Number(s);
      return { instant: s.length >= 12 ? n : n * 1000, kind: "timestamp", tzFixed: true };
    }

    // 带明确偏移或 Z 的 ISO：时刻已确定，与所选源时区无关
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return { instant: t, kind: "iso-absolute", tzFixed: true };
    }

    // 墙上时间：YYYY-MM-DD HH:MM[:SS] 或 YYYY/MM/DD HH:MM
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      return {
        wall: {
          year: +m[1], month: +m[2], day: +m[3],
          hour: m[4] ? +m[4] : 0, minute: m[5] ? +m[5] : 0, second: m[6] ? +m[6] : 0,
        },
        kind: "wall", tzFixed: false,
      };
    }

    // 只给时间，默认今天（按源时区的今天）
    const t2 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (t2) {
      return { timeOnly: { hour: +t2[1], minute: +t2[2], second: t2[3] ? +t2[3] : 0 }, kind: "time-only", tzFixed: false };
    }

    return { error: "无法识别的时间格式" };
  }

  const API = {
    offsetMs, wallToInstant, instantToWall, offsetLabel, abbr, isDST,
    dayDelta, fmtWall, parseInput, isGap, isAmbiguous, pad,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else globalThis.TZMath = API;
})();
