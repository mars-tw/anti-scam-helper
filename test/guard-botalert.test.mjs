import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAntiScamBotAlert } from "../guard/policy.mjs";
import { textNotifyReasons } from "../guard/notify-rules.mjs";

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
  const tracker = { scam: () => true, seen: () => 0, note: () => {}, crossChat: () => [] };
  const out = textNotifyReasons({ text: ALERT + " https://bit.ly/abc", chatId: "c", senderId: "s", result: { verdict: "SCAM", review: "SCAM" }, tracker, shorteners: ["bit.ly"] });
  assert.deepEqual(out, []);
});

test("guard 的回覆／學習／主流程都有跳過提醒", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /function isBotText\(text\) \{\n  return isAntiScamBotAlert\(text\)/);
  assert.match(src, /isAntiScamBotAlert\(text \?\? message\.text\)\) return undefined/);
  assert.match(src, /action: "bot-alert-skipped"/);
});
