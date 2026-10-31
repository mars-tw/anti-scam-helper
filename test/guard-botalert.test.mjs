import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAntiScamBotAlert } from "../guard/policy.mjs";
import { textNotifyReasons, makeNotifyTracker } from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

const ALERT = "疑似詐騙提醒\n訊息 ID：123456789012345678\n詐騙機率：90%\n手法：釣魚詐騙（手法信心度 44%）\n此為模型估計，並非事實判定，請管理員查證。\n@成員甲 @成員乙 @測試帳號";

test("其他防詐機器人的提醒格式會被認出（含空白／全形變體）", () => {
  assert.equal(isAntiScamBotAlert(ALERT), true);
  assert.equal(isAntiScamBotAlert("疑似 詐騙 提醒\n詐騙機率：75％\n此為模型估計，並非事實判定"), true);
  assert.equal(isAntiScamBotAlert("疑似詐騙警示 訊息ID:1 手法：投資詐騙"), true);
});

test("一般訊息與只有標題的不算", () => {
  assert.equal(isAntiScamBotAlert("疑似詐騙提醒：不要加入新群喔"), false);
  assert.equal(isAntiScamBotAlert("這個詐騙機率很高吧？"), false);
  assert.equal(isAntiScamBotAlert("加我 LINE 領飆股 https://example.test/x"), false);
  assert.equal(isAntiScamBotAlert(""), false);
});

test("提醒格式不產生通知理由", () => {
  const out = textNotifyReasons({ text: ALERT, chatId: "c", senderId: "s", result: { verdict: "SCAM", review: "SCAM", names: [] }, tracker: makeNotifyTracker(), shorteners: SHORTENERS });
  assert.deepEqual(out, []);
});

test("guard 的回覆／學習／主流程都有跳過提醒", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /function isBotText\(text\) \{\n  return isAntiScamBotAlert\(text\)/);
  assert.match(src, /isAntiScamBotAlert\(text \?\? message\.text\)\) return undefined/);
  assert.match(src, /action: "bot-alert-skipped"/);
});

import { isPlainAntiScamBotAlert, alertHasLinkSignal } from "../guard/policy.mjs";

test("補洞：提醒格式＋連結／短網址／邀請／LINE ID 不算純提醒", () => {
  assert.equal(isPlainAntiScamBotAlert(ALERT), true);
  for (const extra of [" https://example.test/a", " bit.ly/Ab12cd", " reurl.cc/xyz", " line.me/ti/g2/abcdef", " lin.ee/abc", " 加賴：scam123", " LINE ID: fake_helper", " www.example.test", " fake-site.xyz"]) {
    assert.equal(alertHasLinkSignal(ALERT + extra), true, extra);
    assert.equal(isPlainAntiScamBotAlert(ALERT + extra), false, extra);
    assert.equal(isAntiScamBotAlert(ALERT + extra), true, extra); // 回覆仍不回
  }
});

test("補洞：假提醒＋詐騙連結仍照一般流程通知／計分", () => {
  const fake = "疑似詐騙提醒\n訊息 ID：1\n詐騙機率：90%\n此為模型估計，並非事實判定。本群即將刪除，請大家加入新群 https://bit.ly/Ab12cd";
  const tracker = makeNotifyTracker();
  const out = textNotifyReasons({ text: fake, chatId: "c", senderId: "s", result: { verdict: "SCAM", review: "SCAM", names: [] }, tracker, shorteners: SHORTENERS });
  assert.ok(out.length > 0, "應產生通知理由");
  const score = makeRuleScorer([])({ senderId: "s", channelId: "c" }, fake);
  const plain = makeRuleScorer([])({ senderId: "s", channelId: "c" }, ALERT);
  assert.ok(score.score > plain.score, "有連結的分數要高於純提醒");
});

test("guard：圖片與有 LINE 資訊的提醒不走跳過", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /message\.contentType !== "IMAGE" && isPlainAntiScamBotAlert\(text\) && !hasLineInfo\(text\)/);
});
