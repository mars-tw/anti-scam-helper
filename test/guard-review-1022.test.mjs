import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, errorCode, redPacketExceptionBlocked, visionVerdict } from "../guard/policy.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

// 10/20–10/22 日誌：6 筆只有「網址」、分數 1、地端＋覆核都判 SCAM 的訊息曾被通知（字數 78、156、40、66、40、96）。
test("純網址、分數 1：雙模型 SCAM 改貼可能詐騙（notice）；踢人門檻不變", () => {
  // 10/26 23:01＋10/31：一般連結分數 > 0 且雙模型 SCAM → notice（主路徑改 link-score）
  for (let i = 0; i < 6; i++) assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true }), "notice");
  assert.equal(decideAction({ score: 2, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true }), "notice");
  assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址", "暱稱自稱管理員"], link: true }), "notice");
  // 沒有連結訊號：仍不因雙模型 SCAM 就通知
  assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["私下聯繫"], link: false }), "none");
  assert.equal(decideAction({ score: 7, verdict: "SCAM", review: "SCAM", names: ["網址", "假群組連結"], link: true }), "kick", "踢人門檻不變");
});

test("錯誤分類碼：不含原文，只分類", () => {
  assert.equal(errorCode("connection", "connect ECONNREFUSED 127.0.0.1:3789"), "ECONNREFUSED");
  assert.equal(errorCode("history", "HISTORY_FAILED（15 秒後重試）"), "HISTORY_FAILED");
  assert.equal(errorCode("model", "claude-haiku-5-5：empty-or-unusable-answer"), "MODEL_EMPTY");
  assert.equal(errorCode("model", "x：The operation was aborted due to timeout"), "TIMEOUT");
  assert.equal(errorCode("model", "x：HTTP_529"), "HTTP_529");
  assert.equal(errorCode("media", "something odd"), "MEDIA_OTHER");
});

test("派網紅包例外：跟單／帶單＋QR 或短網址不適用；一般紅包照舊", () => {
  const shortener = new RegExp(`(${SHORTENERS.map((d) => d.replace(/\./g, "\\.")).join("|")})\\/\\w`, "i");
  assert.equal(redPacketExceptionBlocked("掃碼立即跟單 送紅包", { shortener }), true);
  assert.equal(redPacketExceptionBlocked("帶單群 bit.ly/abc", { shortener }), true);
  assert.equal(redPacketExceptionBlocked("新年紅包 QR 大家搶", { shortener }), false);
  assert.equal(redPacketExceptionBlocked("今天跟單心得", { shortener }), false);
});

test("新組合不會單獨達到踢人門檻 6", () => {
  const r = makeRuleScorer();
  assert.ok(r({}, "掃碼立即跟單").score < 6);
  assert.ok(r({}, "跟單 https://x.example/abc").score < 6);
});

test("看圖矛盾降級與模型來源無關（本機模型也套用）", () => {
  assert.equal(visionVerdict("SCAM", "未見任何 QR code、LINE ID、網址或要求匯款"), "UNSURE");
});

test("暱稱：群管大加分；小編／管理／版務一律視為假冒；真管理員（senderRole）不加", () => {
  const r = makeRuleScorer();
  assert.deepEqual(r({ senderName: "群管小明" }, "早安"), { score: 4, names: ["暱稱冒稱群管"] });
  assert.deepEqual(r({ senderName: "happy-小編" }, "早安"), { score: 2, names: ["暱稱自稱管理員"] });
  assert.ok(r({ senderName: "版務阿華" }, "早安").names.includes("暱稱自稱管理員"));
  assert.equal(r({ senderName: "群管小明", senderRole: "admin" }, "早安").score, 0);
  assert.equal(r({ senderName: "阿明" }, "早安").score, 0);
  assert.ok(r({ senderName: "群管小明" }, "早安").score < 6, "暱稱單獨不到踢人門檻");
});

import { decideChatKick, isFakeGroupImage } from "../guard/policy.mjs";
test("刪踢群的假群組圖：直接當詐騙，照 Claude＋覆核規則", () => {
  assert.ok(isFakeGroupImage("圖中要求原成員轉移到新群"));
  const d = (model, review) => decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model, review });
  assert.equal(d("claude-haiku-5-5", "SCAM"), "kick");
  assert.equal(d("claude-haiku-5-5", undefined), "kick");
  assert.equal(d("claude-haiku-5-5", "OK"), "notice");
  assert.equal(d("grok-4.7", "SCAM"), "notice");
});
