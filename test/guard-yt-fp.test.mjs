import { test } from "node:test";
import assert from "node:assert/strict";
import { isMainstreamMediaHost, onlyMainstreamMediaLinks, textNotifyReasons, zeroScoreShouldNotify, makeNotifyTracker } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
import { sendNotice, withAgentLabel } from "../guard/notice.mjs";

// 一般影片分享：規則 0 分，網址只有主流影音網站。
const TEXT = "這支影片實測新模型，蠻有參考價值 https://www.youtube.com/watch?v=abcdefghijk";

test("主流影音／社群網址本身不加分（規則 0 分）", () => {
  for (const t of [TEXT, "看這個 https://youtu.be/abcdefghijk", "https://m.youtube.com/watch?v=abc", "https://music.youtube.com/watch?v=abc", "https://vimeo.com/123"]) {
    assert.equal(makeRuleScorer()({}, t).score, 0, t);
  }
});
test("主流影音網域判斷：子網域算，仿冒網域不算", () => {
  for (const h of ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]) assert.equal(isMainstreamMediaHost(h), true, h);
  for (const h of ["youtube.com.evil.xyz", "fakeyoutube.com", "youtu.be.example.top"]) assert.equal(isMainstreamMediaHost(h), false, h);
  assert.equal(onlyMainstreamMediaLinks(TEXT), true);
  assert.equal(onlyMainstreamMediaLinks(`${TEXT} https://example.top/x`), false, "混了其他網址就不算");
  assert.equal(onlyMainstreamMediaLinks("沒有網址"), false);
});
test("0 分＋兩層模型都判詐：沒有確定特徵 → 不通知（只記錄）", () => {
  assert.equal(zeroScoreShouldNotify([]), false);
  assert.equal(zeroScoreShouldNotify(["網址"]), false);
  const names = textNotifyReasons({ text: TEXT, chatId: "c1", senderId: "u1", result: { score: 0, names: [], verdict: "OK", zeroScoreScamReviewed: true }, tracker: makeNotifyTracker() });
  assert.ok(!names.includes("0 分但第一層與雲端覆核都判詐騙"));
});
test("0 分＋兩層判詐＋確定特徵（群組邀請／未知短網址／已知詐騙網域）→ 照舊通知", () => {
  for (const n of ["群組邀請連結", "疑似短網址", "已知詐騙網域"]) assert.equal(zeroScoreShouldNotify([n]), true, n);
});
test("所有群內通知結尾都帶（AI代理），不重複加，@ 位置不變", async () => {
  assert.equal(withAgentLabel("⚠️ 反詐小幫手：測試"), "⚠️ 反詐小幫手：測試（AI代理）");
  assert.equal(withAgentLabel("回覆（AI代理）"), "回覆（AI代理）");
  const frames = [];
  const text = "⚠️ 反詐小幫手：請管理員確認。\n@管理員 請管理員留意";
  const mentions = [{ userId: "a", start: text.indexOf("@"), end: text.indexOf("@") + 4 }];
  await sendNotice(async (f) => { frames.push(f); return { type: "sent", messageId: "m" }; }, { chatId: "c", text, mentions, replyTo: "r" });
  assert.ok(frames[0].text.endsWith("（AI代理）"));
  assert.equal(frames[0].text.slice(mentions[0].start, mentions[0].end), "@管理員");
});
