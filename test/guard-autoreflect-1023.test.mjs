import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyScore, textNotifyReasons, makeNotifyTracker, MINER_KICKABLE } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

// 10/23 自動反思：兩條只通知的規則（去識別化範例）。
const SIM = "收購門號／SIM 卡（人頭門號）";
const FAKE = "仿 LINE 社群邀請文字但連結不是 LINE";
const rs = makeRuleScorer();
const reasons = (text) => textNotifyReasons({ text, chatId: "c1", senderId: "u1", result: { verdict: "OK", names: [] }, tracker: makeNotifyTracker() });

test("收購門號／SIM 卡話術：直接通知", () => {
  for (const t of [
    "收各大電信 月租｜預付｜實體卡 作業完成後結款 歡迎卡商配合 line：abc123",
    "高價收購門號、預付卡，現金當面結",
    "收SIM卡 需要的私我",
  ]) {
    const n = notifyScore(t);
    assert.ok(n.notify && n.names.includes(SIM), t);
    assert.ok(reasons(t).includes(SIM), t);
  }
});

test("一般電信討論不觸發收購門號規則", () => {
  for (const t of [
    "我手機收不到電信簡訊，要去門市問",
    "收到電信帳單了，付款要去超商嗎",
    "預付卡跟月租哪個划算？",
    "有人在收購門號叫我賣，這是詐騙嗎",
  ]) assert.ok(!notifyScore(t).names.includes(SIM), t);
});

test("仿 LINE 社群邀請文字＋非 LINE 連結：直接通知", () => {
  for (const t of [
    "您已被邀請加入「某某旅遊」！請點選以下連結加入社群！ https://example-invite.test/abc",
    "您 已 被 邀 請 加 入「福利社群」 請點選以下連結加入社群 fake-site.xyz/r/QQ",
  ]) assert.ok(notifyScore(t).names.includes(FAKE), t);
});

test("真的 LINE 社群邀請或沒有連結不觸發仿邀請規則", () => {
  for (const t of [
    "您已被邀請加入「讀書會」！請點選以下連結加入社群！ https://line.me/ti/g2/AbCdEf",
    "我已被邀請加入公司的社群了",
    "請點選以下連結加入社群（連結稍後補）",
  ]) assert.ok(!notifyScore(t).names.includes(FAKE), t);
});

test("兩條新規則只通知：不改踢人分數、不在踢人群可踢清單", () => {
  assert.ok(!MINER_KICKABLE.has(SIM) && !MINER_KICKABLE.has(FAKE));
  const base = rs({}, "收各大電信 月租 預付 實體卡").score;
  assert.ok(base < 6);
  const t = "您已被邀請加入「某某旅遊」！請點選以下連結加入社群！ https://example-invite.test/abc";
  assert.ok(rs({}, t).score < 6, "仿邀請文字本身不達踢人門檻（規則層未改）");
});
