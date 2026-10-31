import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyScore, noticeTips, MINER_KICKABLE } from "../guard/notify-rules.mjs";

// 10/23 晨會：兩條只通知規則（去識別化範例）。
const VOTE = "假投票／活動騙認證碼";
const MOVE = "假管理員搬群話術";

test("假投票：投票＋非官方外部連結或要認證碼 → 通知", () => {
  for (const t of ["幫我女兒投一票 https://vote.scam-example.test/a", "票選活動請輸入手機號碼和 LINE 認證碼", "參加比賽拉票，驗證碼傳給我"]) {
    const r = notifyScore(t); assert.ok(r.notify && r.names.includes(VOTE), t);
  }
});

test("假投票：正常投票討論、官方平台網址不觸發", () => {
  for (const t of ["大家投票午餐吃什麼", "比賽影片 https://youtu.be/abc", "票選 https://b23.tv/x", "投票表單 https://forms.gle/abc", "今天比賽好精彩"]) {
    assert.ok(!notifyScore(t).names.includes(VOTE), t);
  }
});

test("假管理員搬群話術 → 通知且附看皇冠說明", () => {
  const r = notifyScore("群裡機器人洗版太嚴重，管理員開新群了");
  assert.ok(r.notify && r.names.includes(MOVE));
  const tips = noticeTips(r.names).join("");
  assert.match(tips, /皇冠/); assert.match(tips, /假群組/); assert.doesNotMatch(tips, /換群/);
  assert.ok(!notifyScore("今天天氣不錯，大家早安").names.includes(MOVE));
});

test("兩條新規則都不進踢人規則", () => {
  assert.ok(!MINER_KICKABLE.has(VOTE)); assert.ok(!MINER_KICKABLE.has(MOVE));
});

test("假投票：第一層 OK 且只有外部網址 → 不通知；有認證碼仍通知；雙 OK 不通知", () => {
  const urlOnly = "幫我女兒投一票 https://vote.scam-example.test/a";
  assert.ok(notifyScore(urlOnly).names.includes(VOTE));
  assert.ok(!notifyScore(urlOnly, { verdict: "OK" }).names.includes(VOTE));
  assert.ok(!notifyScore(urlOnly, { verdict: "OK", review: "OK" }).names.includes(VOTE));
  const withCode = "票選活動請輸入手機號碼和 LINE 認證碼";
  assert.ok(notifyScore(withCode, { verdict: "OK" }).names.includes(VOTE));
  assert.ok(!notifyScore(withCode, { verdict: "OK", review: "OK" }).names.includes(VOTE));
});
