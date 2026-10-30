// 10/30 誤判 B：自動回覆跳過（連結／邀請＋分數>0，或剛被通知）；不影響通知／踢人。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasLinkOrInviteText, shouldSkipAutoReply } from "../guard/reply-skip.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

const score = makeRuleScorer([]);

test("回覆閘門：含連結／邀請且分數>0 → 跳過", () => {
  const text = "幫我測試這個能不能申請 https://urlr.me/AbCdEf";
  const { score: s } = score({}, text);
  assert.ok(s > 0, `expected score>0 got ${s}`);
  assert.equal(hasLinkOrInviteText(text), true);
  assert.deepEqual(shouldSkipAutoReply({ text, score: s }), { skip: true, reason: "link-or-invite-score" });
});

test("回覆閘門：群組邀請＋分數>0 → 跳過", () => {
  const text = "請加入 https://line.me/ti/g2/AbCdEfGhIjK 測試申請";
  const { score: s } = score({}, text);
  assert.ok(s > 0);
  assert.equal(shouldSkipAutoReply({ text, score: s }).skip, true);
});

test("回覆閘門：剛被通知過 → 即使無連結也跳過", () => {
  assert.deepEqual(
    shouldSkipAutoReply({ text: "你好小幫手", score: 0, senderRecentlyNotified: true }),
    { skip: true, reason: "sender-recently-notified" },
  );
});

test("回覆閘門對抗：無連結分數 0、未通知 → 不跳過", () => {
  assert.deepEqual(shouldSkipAutoReply({ text: "小幫手你好，今天天氣如何", score: 0 }), { skip: false, reason: undefined });
});

test("回覆閘門對抗：有連結但分數 0 → 不因本閘跳過（交給原 scam-check）", () => {
  // 分數門檻是 >0；0 分連結不在此閘（避免誤擋一般分享提問）
  assert.deepEqual(shouldSkipAutoReply({ text: "https://example.com/ok", score: 0 }), { skip: false, reason: undefined });
});

test("urlr.me 在已知短網址清單（通用短網址服務）", () => {
  assert.ok(SHORTENERS.includes("urlr.me"));
  const { names } = score({}, "請看 https://urlr.me/AbCd12");
  assert.ok(names.includes("短網址"), names);
  assert.equal(names.includes("疑似短網址"), false);
});

test("三種群語意：閘門只回 skip，guard 只在 reply() 使用（不碰通知／踢人）", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /shouldSkipAutoReply/);
  const at = src.indexOf("shouldSkipAutoReply(");
  const fn = src.lastIndexOf("async function reply(ws, message", at);
  assert.ok(fn > 0 && at - fn < 800, "應在 reply() 內");
  // 不應出現在 remove／kick 路徑關鍵字附近當條件（粗檢查：reply-skipped reason 不含 kick）
  assert.match(src, /reason: gate\.reason/);
  assert.match(src, /markReplySkipNotified/);
});

test("叫名字／@／補回／botCamp 皆經 reply()：單一閘門覆蓋", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /await reply\(ws, message, text, \{ camp: true/);
  assert.match(src, /await reply\(ws, message, ask\)/);
  // catch-up 進 queue → handle → reply；botCampAct 直接 reply
  assert.equal((src.match(/shouldSkipAutoReply\(/g) || []).length, 1);
});
