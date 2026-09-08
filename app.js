// timezone — 外媒发布时间换算
// 时间数学全部在 tzmath.js 里，这里只做界面与状态。

(() => {
  "use strict";

  const T = globalThis.TZMath;

  // 新闻中心优先，其次覆盖主要时区
  const PRESETS = [
    { tz: "Asia/Shanghai",     label: "北京 / 上海" },
    { tz: "Asia/Hong_Kong",    label: "香港" },
    { tz: "Asia/Taipei",       label: "台北" },
    { tz: "UTC",               label: "UTC / GMT" },
    { tz: "Europe/London",     label: "伦敦" },
    { tz: "America/New_York",  label: "纽约" },
    { tz: "Asia/Tokyo",        label: "东京" },
    { tz: "Asia/Singapore",    label: "新加坡" },
    { tz: "Europe/Paris",      label: "巴黎" },
    { tz: "Europe/Berlin",     label: "柏林" },
    { tz: "Europe/Moscow",     label: "莫斯科" },
    { tz: "America/Los_Angeles", label: "洛杉矶" },
    { tz: "America/Chicago",   label: "芝加哥" },
    { tz: "Asia/Dubai",        label: "迪拜" },
    { tz: "Asia/Seoul",        label: "首尔" },
    { tz: "Australia/Sydney",  label: "悉尼" },
    { tz: "Asia/Kolkata",      label: "新德里" },
    { tz: "America/Sao_Paulo", label: "圣保罗" },
    { tz: "Africa/Johannesburg", label: "约翰内斯堡" },
    { tz: "Asia/Jerusalem",    label: "耶路撒冷" },
  ];

  const LABEL = new Map(PRESETS.map((p) => [p.tz, p.label]));
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const DEFAULT_TARGETS = ["Asia/Shanghai", "UTC", "America/New_York", "Europe/London"];
  const STORE_KEY = "tz-targets";

  const $ = (s) => document.querySelector(s);
  const els = {
    srcZone: $("#srcZone"),
    input: $("#rawInput"),
    nowBtn: $("#nowBtn"),
    parsed: $("#parsed"),
    zoneList: $("#zoneList"),
    addZone: $("#addZone"),
    resetBtn: $("#resetBtn"),
    unixOut: $("#unixOut"),
    isoOut: $("#isoOut"),
    status: $("#status"),
    hint: $("#hint"),
    themeToggle: $("#themeToggle"),
    themeLabel: $("#themeLabel"),
  };

  const state = {
    src: LABEL.has(localTz) ? localTz : "UTC",
    targets: loadTargets(),
    instant: Date.now(),
    live: true,
  };

  function loadTargets() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (Array.isArray(raw) && raw.length) return raw.filter(isValidTz);
    } catch { /* 忽略损坏的存档 */ }
    const base = DEFAULT_TARGETS.slice();
    if (isValidTz(localTz) && !base.includes(localTz)) base.unshift(localTz);
    return base;
  }
  function saveTargets() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.targets));
  }
  function isValidTz(tz) {
    if (typeof tz !== "string" || !tz) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
    catch { return false; }
  }

  // ---------- 主题 ----------
  const THEME_KEY = "toolkit-theme";
  const root = document.documentElement;
  function applyTheme(theme) {
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    const isLight = theme === "light" || (theme === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    els.themeLabel.textContent = isLight ? "深色" : "浅色";
  }
  els.themeToggle.addEventListener("click", () => {
    const cur = localStorage.getItem(THEME_KEY) || "auto";
    const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  applyTheme(localStorage.getItem(THEME_KEY) || "auto");

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const zoneName = (tz) => LABEL.get(tz) || tz.split("/").pop().replace(/_/g, " ");

  // ---------- 源时区下拉 ----------
  function fillSrcZones() {
    const zones = PRESETS.map((p) => p.tz);
    if (isValidTz(localTz) && !zones.includes(localTz)) zones.unshift(localTz);
    els.srcZone.innerHTML = zones.map((tz) =>
      `<option value="${esc(tz)}"${tz === state.src ? " selected" : ""}>${esc(zoneName(tz))}${tz === localTz ? "（本机）" : ""}</option>`
    ).join("");
  }

  // ---------- 解析输入 ----------
  function resolveInstant() {
    const raw = els.input.value.trim();

    if (!raw) {
      state.live = true;
      state.instant = Date.now();
      els.parsed.textContent = "跟随当前时间";
      els.parsed.className = "parsed live";
      setStatus("ready", "实时");
      els.hint.textContent = "";
      return true;
    }

    state.live = false;
    const p = T.parseInput(raw);

    if (!p || p.error) {
      els.parsed.textContent = "无法识别";
      els.parsed.className = "parsed bad";
      setStatus("error", "格式错误");
      els.hint.textContent = "支持：2026-07-27 14:30 · 14:30 · 1753600000 · 2026-07-27T14:30Z";
      return false;
    }

    els.hint.textContent = "";

    if (p.kind === "timestamp") {
      state.instant = p.instant;
      els.parsed.textContent = "Unix 时间戳（绝对时刻）";
      els.parsed.className = "parsed ok";
      setStatus("ok", "已换算");
      return true;
    }

    if (p.kind === "iso-absolute") {
      state.instant = p.instant;
      els.parsed.textContent = "含时区偏移的 ISO 时间（绝对时刻，不受上方时区影响）";
      els.parsed.className = "parsed ok";
      setStatus("ok", "已换算");
      return true;
    }

    // 墙上时间：需要用源时区还原
    let wall;
    if (p.kind === "time-only") {
      const today = T.instantToWall(Date.now(), state.src);
      wall = { year: today.year, month: today.month, day: today.day, ...p.timeOnly };
    } else {
      wall = p.wall;
    }

    if (!T.isValidWall(wall)) {
      els.parsed.textContent = "日期或时间超出范围";
      els.parsed.className = "parsed bad";
      setStatus("error", "数值无效");
      return false;
    }

    state.instant = T.wallToInstant(wall, state.src);

    // 夏令时边界提示——这是最容易出错、也最该告诉用户的地方
    if (T.isGap(wall, state.src)) {
      els.parsed.textContent = `${zoneName(state.src)} 的这个时间不存在（夏令时前拨跳过），已按拨后时间计算`;
      els.parsed.className = "parsed warn";
      setStatus("busy", "夏令时缺口");
    } else if (T.isAmbiguous(wall, state.src)) {
      els.parsed.textContent = `${zoneName(state.src)} 的这个时间出现两次（夏令时回拨），已取先出现的那次`;
      els.parsed.className = "parsed warn";
      setStatus("busy", "时间有歧义");
    } else {
      const src = T.instantToWall(state.instant, state.src);
      const f = T.fmtWall(src);
      els.parsed.textContent = `${zoneName(state.src)} ${f.date} ${f.time} ${T.offsetLabel(state.instant, state.src)}`;
      els.parsed.className = "parsed ok";
      setStatus("ok", "已换算");
    }
    return true;
  }

  // ---------- 渲染各时区 ----------
  function renderZones() {
    const inst = state.instant;

    els.zoneList.innerHTML = state.targets.map((tz) => {
      const w = T.instantToWall(inst, tz);
      const f = T.fmtWall(w);
      const delta = T.dayDelta(inst, tz, state.src);
      const dst = T.isDST(inst, tz);
      const ab = T.abbr(inst, tz);

      const dayTag = delta === 0 ? "" :
        `<span class="daytag ${delta > 0 ? "next" : "prev"}">${delta > 0 ? "+1 天" : "-1 天"}</span>`;
      const dstTag = dst ? '<span class="dsttag" title="正在实行夏令时">夏令时</span>' : "";
      const isSrc = tz === state.src;

      return `
        <div class="zone${isSrc ? " is-src" : ""}">
          <div class="zone-main">
            <div class="zone-time">${f.time}</div>
            <div class="zone-meta">
              <span class="zone-name">${esc(zoneName(tz))}${isSrc ? "（源）" : ""}</span>
              <span class="zone-date">${f.date} ${esc(f.weekday)}</span>
            </div>
          </div>
          <div class="zone-side">
            <div class="zone-tags">${dayTag}${dstTag}</div>
            <div class="zone-off">${esc(ab)} · ${esc(T.offsetLabel(inst, tz))}</div>
          </div>
          <button class="zone-del" data-del="${esc(tz)}" title="移除" aria-label="移除 ${esc(zoneName(tz))}">×</button>
        </div>`;
    }).join("");

    els.unixOut.textContent = Math.floor(inst / 1000);
    els.isoOut.textContent = new Date(inst).toISOString().replace(".000", "");
  }

  function render() {
    resolveInstant();
    renderZones();
  }

  function setStatus(kind, text) {
    els.status.className = "status " + kind;
    els.status.textContent = text;
  }

  // ---------- 添加时区 ----------
  function buildAddMenu() {
    const all = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : PRESETS.map((p) => p.tz);
    const opts = ['<option value="">添加城市…</option>'];
    const presetLeft = PRESETS.filter((p) => !state.targets.includes(p.tz));
    if (presetLeft.length) {
      opts.push('<optgroup label="常用新闻中心">');
      for (const p of presetLeft) opts.push(`<option value="${esc(p.tz)}">${esc(p.label)}</option>`);
      opts.push("</optgroup>");
    }
    opts.push('<optgroup label="全部时区">');
    for (const tz of all) {
      if (state.targets.includes(tz)) continue;
      opts.push(`<option value="${esc(tz)}">${esc(tz)}</option>`);
    }
    opts.push("</optgroup>");
    els.addZone.innerHTML = opts.join("");
  }

  els.addZone.addEventListener("change", () => {
    const tz = els.addZone.value;
    if (!tz || !isValidTz(tz) || state.targets.includes(tz)) return;
    state.targets = [...state.targets, tz];
    saveTargets();
    buildAddMenu();
    renderZones();
  });

  els.resetBtn.addEventListener("click", () => {
    state.targets = DEFAULT_TARGETS.slice();
    if (isValidTz(localTz) && !state.targets.includes(localTz)) state.targets.unshift(localTz);
    saveTargets();
    buildAddMenu();
    renderZones();
  });

  els.zoneList.addEventListener("click", (e) => {
    const tz = e.target.closest("[data-del]")?.dataset.del;
    if (!tz) return;
    state.targets = state.targets.filter((t) => t !== tz);
    saveTargets();
    buildAddMenu();
    renderZones();
  });

  // ---------- 输入事件 ----------
  let debounce;
  els.input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 140);
  });

  els.srcZone.addEventListener("change", () => {
    state.src = els.srcZone.value;
    render();
  });

  els.nowBtn.addEventListener("click", () => {
    els.input.value = "";
    render();
    els.input.focus();
  });

  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "copy-unix" || act === "copy-iso") {
      const v = act === "copy-unix" ? els.unixOut.textContent : els.isoOut.textContent;
      const btn = e.target.closest("[data-act]");
      navigator.clipboard.writeText(v).then(() => {
        const orig = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => { btn.textContent = orig; }, 900);
      }).catch(() => setStatus("error", "复制失败"));
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement === els.input) {
      els.input.value = "";
      render();
    }
  });

  // ---------- 启动 ----------
  if (!T) {
    setStatus("error", "模块未加载");
    els.hint.textContent = "tzmath.js 缺失";
    return;
  }

  fillSrcZones();
  buildAddMenu();
  render();

  // 实时模式下每秒走字；输入了具体时间就停住
  setInterval(() => {
    if (!state.live) return;
    state.instant = Date.now();
    renderZones();
  }, 1000);
})();
