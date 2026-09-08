// tzmath 测试 —— 需求驱动，重点覆盖夏令时边界
const T = require("./tzmath.js");
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}\n  got  ${got}\n  want ${want}`);
}

// ---- 1. 基本偏移 ----
eq("上海偏移", T.offsetLabel(Date.UTC(2026, 6, 27, 12), "Asia/Shanghai"), "GMT+08:00");
eq("印度半小时时区", T.offsetLabel(Date.UTC(2026, 6, 27, 12), "Asia/Kolkata"), "GMT+05:30");
eq("尼泊尔 45 分钟", T.offsetLabel(Date.UTC(2026, 6, 27, 12), "Asia/Kathmandu"), "GMT+05:45");
eq("UTC", T.offsetLabel(Date.UTC(2026, 6, 27, 12), "UTC"), "GMT+00:00");

// ---- 2. 夏令时：纽约冬夏偏移不同 ----
eq("纽约夏季", T.offsetLabel(Date.UTC(2026, 6, 15, 12), "America/New_York"), "GMT-04:00");
eq("纽约冬季", T.offsetLabel(Date.UTC(2026, 0, 15, 12), "America/New_York"), "GMT-05:00");
eq("纽约夏季 DST", T.isDST(Date.UTC(2026, 6, 15, 12), "America/New_York"), "true");
eq("纽约冬季 DST", T.isDST(Date.UTC(2026, 0, 15, 12), "America/New_York"), "false");
eq("上海无夏令时", T.isDST(Date.UTC(2026, 6, 15, 12), "Asia/Shanghai"), "false");

// 南半球反向：悉尼 1 月是夏令时
eq("悉尼 1 月 DST", T.isDST(Date.UTC(2026, 0, 15, 1), "Australia/Sydney"), "true");
eq("悉尼 7 月 DST", T.isDST(Date.UTC(2026, 6, 15, 1), "Australia/Sydney"), "false");

// ---- 3. 核心：路透 GMT 发稿换算北京时间 ----
// 2026-07-27 14:30 UTC -> 北京 22:30 同日
{
  const inst = T.wallToInstant({ year: 2026, month: 7, day: 27, hour: 14, minute: 30 }, "UTC");
  const sh = T.fmtWall(T.instantToWall(inst, "Asia/Shanghai"));
  eq("UTC14:30 -> 北京", `${sh.date} ${sh.time}`, "2026-07-27 22:30");
}
// 纽约 20:00 -> 北京次日 08:00（跨日）
{
  const inst = T.wallToInstant({ year: 2026, month: 7, day: 27, hour: 20, minute: 0 }, "America/New_York");
  const sh = T.fmtWall(T.instantToWall(inst, "Asia/Shanghai"));
  eq("NY20:00 -> 北京", `${sh.date} ${sh.time}`, "2026-07-28 08:00");
  eq("跨日标记", T.dayDelta(inst, "Asia/Shanghai", "America/New_York"), "1");
}
// 北京 09:00 -> 伦敦 02:00 同日
{
  const inst = T.wallToInstant({ year: 2026, month: 7, day: 27, hour: 9, minute: 0 }, "Asia/Shanghai");
  const ld = T.fmtWall(T.instantToWall(inst, "Europe/London"));
  eq("北京09:00 -> 伦敦", `${ld.date} ${ld.time}`, "2026-07-27 02:00");
}

// ---- 4. 往返一致性（多时区 x 多时刻）----
{
  const zones = ["Asia/Shanghai", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "Asia/Kolkata", "America/Sao_Paulo", "UTC"];
  let rt = 0;
  for (const tz of zones) {
    for (const month of [1, 4, 7, 11]) {
      const wall = { year: 2026, month, day: 15, hour: 13, minute: 45, second: 0 };
      const inst = T.wallToInstant(wall, tz);
      const back = T.instantToWall(inst, tz);
      if (back.year === wall.year && back.month === wall.month && back.day === wall.day &&
          back.hour === wall.hour && back.minute === wall.minute) rt++;
      else console.log(`  往返失败 ${tz} ${month}月 -> ${JSON.stringify(back)}`);
    }
  }
  eq("往返一致 32 组", rt, 32);
}

// ---- 5. 夏令时切换瞬间 ----
// 美国 2026-03-08 02:00 前拨 -> 02:30 不存在
eq("不存在的时间", T.isGap({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York"), "true");
eq("正常时间非 gap", T.isGap({ year: 2026, month: 3, day: 8, hour: 5, minute: 30 }, "America/New_York"), "false");
// 美国 2026-11-01 02:00 回拨 -> 01:30 出现两次
eq("重复的时间", T.isAmbiguous({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York"), "true");
eq("正常时间非重复", T.isAmbiguous({ year: 2026, month: 11, day: 1, hour: 5, minute: 30 }, "America/New_York"), "false");

// 切换前后一小时的偏移确实变了
{
  const before = T.offsetLabel(Date.UTC(2026, 2, 8, 6, 59), "America/New_York"); // 01:59 EST
  const after = T.offsetLabel(Date.UTC(2026, 2, 8, 7, 1), "America/New_York");   // 03:01 EDT
  eq("前拨前 EST", before, "GMT-05:00");
  eq("前拨后 EDT", after, "GMT-04:00");
}

// ---- 6. 午夜边界 ----
{
  const inst = T.wallToInstant({ year: 2026, month: 7, day: 27, hour: 0, minute: 0 }, "Asia/Shanghai");
  const w = T.instantToWall(inst, "Asia/Shanghai");
  eq("午夜 hour=0", w.hour, 0);
  eq("午夜日期不漂移", `${w.year}-${w.month}-${w.day}`, "2026-7-27");
}
{
  // 23:59 不应跨日
  const inst = T.wallToInstant({ year: 2026, month: 12, day: 31, hour: 23, minute: 59 }, "Asia/Shanghai");
  const w = T.instantToWall(inst, "Asia/Shanghai");
  eq("跨年前一分钟", `${w.year}-${w.month}-${w.day} ${w.hour}:${w.minute}`, "2026-12-31 23:59");
}

// ---- 7. 输入解析 ----
eq("解析 Unix 秒", T.parseInput("1769500000").instant, 1769500000000);
eq("解析 Unix 毫秒", T.parseInput("1769500000000").instant, 1769500000000);
eq("解析带 Z", T.parseInput("2026-07-27T14:30:00Z").kind, "iso-absolute");
eq("解析带偏移", T.parseInput("2026-07-27T14:30:00+08:00").kind, "iso-absolute");
eq("解析墙上时间", T.parseInput("2026-07-27 14:30").kind, "wall");
eq("解析斜杠日期", T.parseInput("2026/07/27 14:30").kind, "wall");
eq("解析仅日期", T.parseInput("2026-07-27").wall.hour, 0);
eq("解析仅时间", T.parseInput("14:30").kind, "time-only");
eq("空输入", T.parseInput("   "), "null");
eq("垃圾输入报错", T.parseInput("hello world").error, "无法识别的时间格式");
// 带 Z 的输入其时刻必须与源时区无关
eq("Z 时刻绝对", T.parseInput("2026-07-27T14:30:00Z").instant, Date.UTC(2026, 6, 27, 14, 30));

// ---- 8. 时区缩写 ----
eq("纽约夏季缩写", T.abbr(Date.UTC(2026, 6, 15, 16), "America/New_York"), "EDT");
eq("纽约冬季缩写", T.abbr(Date.UTC(2026, 0, 15, 17), "America/New_York"), "EST");

// ---- 9. dayDelta ----
{
  // 北京 08:00 时，纽约还是前一天
  const inst = T.wallToInstant({ year: 2026, month: 7, day: 27, hour: 8, minute: 0 }, "Asia/Shanghai");
  eq("纽约落后一天", T.dayDelta(inst, "America/New_York", "Asia/Shanghai"), "-1");
  eq("自身为 0", T.dayDelta(inst, "Asia/Shanghai", "Asia/Shanghai"), "0");
}




// ---- 10. Fixes verification (Years 0-99, padding, BC era, invalid dates) ----
eq("Year 24 parse", T.parseInput("0024-07-27 14:30").wall.year, 24);
eq("Year 24 offset ms", T.offsetMs(T.wallToInstant({ year: 24, month: 7, day: 27, hour: 14, minute: 30 }, "UTC"), "UTC"), 0);
eq("Year -5 offset ms", T.offsetMs(T.wallToInstant({ year: -5, month: 1, day: 1, hour: 12, minute: 0 }, "UTC"), "UTC"), 0);
eq("Year -24 padding", T.fmtWall({ year: -24, month: 1, day: 1, hour: 12, minute: 0, second: 0, weekday: "Mon" }, true).date, "-0024-01-01");
eq("isValidWall strict fail (Feb 30)", T.isValidWall({year: 2026, month: 2, day: 30, hour: 12, minute: 0}), false);
eq("isValidWall strict pass (Feb 28)", T.isValidWall({year: 2026, month: 2, day: 28, hour: 12, minute: 0}), true);
eq("isValidWall strict pass (Leap Feb 29)", T.isValidWall({year: 2024, month: 2, day: 29, hour: 12, minute: 0}), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
