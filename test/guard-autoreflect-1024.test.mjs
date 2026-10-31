// 10/24 自動反思（去識別化範例）：兩個只會「更少通知」的誤判修正。踢人分數不變。
import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyScore, textNotifyReasons, makeNotifyTracker } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const MOVE = "假管理員搬群話術";
const INV = "投資帶單＋第一層非 OK";
const run = (text, result) => textNotifyReasons({ text, chatId: "c1", senderId: "u1", result, tracker: makeNotifyTracker() });

test("防詐提醒文字提到搬群／新群、沒有網址：不觸發搬群話術", () => {
  for (const t of ["⚠️疑似詐騙提醒：有人冒充管理員說要搬群，請不要加入新群", "提醒大家小心假冒管理員，說開新群的都是假的", "請勿加入陌生人說的新群"]) {
    assert.ok(!notifyScore(t).names.includes(MOVE), t);
    assert.ok(!run(t, { verdict: "UNSURE" }).includes(MOVE), t);
  }
});

test("搬群話術沒有網址、第一層與覆核都判 OK：不通知", () => {
  assert.ok(!run("群裡機器人洗版太嚴重，管理員開新群了", { verdict: "OK", review: "OK" }).includes(MOVE));
});

test("搬群話術仍照舊通知：模型沒都判 OK，或帶網址／邀請", () => {
  assert.ok(run("群裡機器人洗版太嚴重，管理員開新群了", { verdict: "UNSURE" }).includes(MOVE));
  assert.ok(notifyScore("群裡機器人洗版太嚴重，管理員開新群了").names.includes(MOVE));
  assert.ok(run("管理員開新群了 https://line.me/ti/g2/abcdef", { verdict: "OK", review: "OK" }).includes(MOVE));
  assert.ok(run("提醒：小心詐騙，我們搬群了 https://short.example.test/x", { verdict: "OK", review: "OK" }).includes(MOVE));
});

test("投資字眼＋第一層 SCAM 但覆核 OK、沒網址、非招攬：不通知", () => {
  assert.ok(!run("今天又入金一點，看能不能回本", { verdict: "SCAM", review: "OK", names: ["投資帶單"] }).includes(INV));
});

test("投資字眼＋第一層 SCAM：覆核非 OK、明確招攬或帶網址仍通知", () => {
  assert.ok(run("今天又入金一點，看能不能回本", { verdict: "SCAM", review: "SCAM", names: ["投資帶單"] }).includes(INV));
  assert.ok(run("今天又入金一點，看能不能回本", { verdict: "SCAM", names: ["投資帶單"] }).includes(INV));
  assert.ok(run("叫你先入金，保證獲利", { verdict: "SCAM", review: "OK", names: ["投資帶單"] }).includes(INV));
  assert.ok(run("入金看這裡 https://x.example.test/a", { verdict: "SCAM", review: "OK", names: ["投資帶單"] }).includes(INV));
});

test("踢人規則分數不變", () => {
  const score = makeRuleScorer();
  assert.equal(score({}, "看起來有入金一點喔").score, 2);
});
