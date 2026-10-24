import { test } from "node:test";
import assert from "node:assert/strict";
import { makeNotifyTracker, textNotifyReasons, REPEAT_SCAM } from "../guard/notify-rules.mjs";

test("0 分＋覆核 UNSURE：同人第 2 次判詐騙只記錄不通知", () => {
  const tr = makeNotifyTracker(); const logs = [];
  const r = { verdict: "SCAM", score: 0, review: "UNSURE", names: [] };
  assert.deepEqual(textNotifyReasons({ text: "今天好熱", chatId: "cA", senderId: "u1", result: r, tracker: tr }), []);
  assert.deepEqual(textNotifyReasons({ text: "今天好熱", chatId: "cA", senderId: "u1", result: r, tracker: tr, log: (x) => logs.push(x) }), []);
  assert.ok(logs.some((x) => x.zeroScoreRepeatLogged));
});
test("0 分＋覆核 SCAM 但沒確定特徵：仍只記錄", () => {
  const tr = makeNotifyTracker();
  const r = { verdict: "SCAM", score: 0, review: "SCAM", names: [] };
  textNotifyReasons({ text: "a", chatId: "cA", senderId: "u2", result: r, tracker: tr });
  assert.ok(!textNotifyReasons({ text: "a", chatId: "cA", senderId: "u2", result: r, tracker: tr }).includes(REPEAT_SCAM));
});
test("沒有 score 欄位視同 0 分", () => {
  const tr = makeNotifyTracker();
  const r = { verdict: "SCAM", names: [] };
  textNotifyReasons({ text: "a", chatId: "cA", senderId: "u3", result: r, tracker: tr });
  assert.deepEqual(textNotifyReasons({ text: "a", chatId: "cA", senderId: "u3", result: r, tracker: tr }), []);
});
test("有分數時第 2 次判詐騙照舊通知", () => {
  const tr = makeNotifyTracker();
  const r = { verdict: "SCAM", score: 1, review: "UNSURE", names: ["網址"] };
  textNotifyReasons({ text: "a", chatId: "cA", senderId: "u4", result: r, tracker: tr });
  assert.ok(textNotifyReasons({ text: "a", chatId: "cA", senderId: "u4", result: r, tracker: tr }).includes(REPEAT_SCAM));
});
test("0 分＋覆核 SCAM＋確定特徵：第 2 次可通知", () => {
  const tr = makeNotifyTracker();
  const r = { verdict: "SCAM", score: 0, review: "SCAM", names: ["已知詐騙網域"] };
  textNotifyReasons({ text: "a", chatId: "cA", senderId: "u5", result: r, tracker: tr });
  assert.ok(textNotifyReasons({ text: "a", chatId: "cA", senderId: "u5", result: r, tracker: tr }).includes(REPEAT_SCAM));
});
