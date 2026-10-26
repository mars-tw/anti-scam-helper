import test from "node:test";
import assert from "node:assert/strict";
import { notifyScore, textNotifyReasons, makeNotifyTracker, ADVISOR_LURE, MINER_KICKABLE, noticeTips } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
const ruleScore = makeRuleScorer();

const scam = { verdict: "SCAM", review: "SCAM" };
const has = (t, ctx = scam) => notifyScore(t, ctx).names.includes(ADVISOR_LURE);
const AD = "專業投顧分析師一對一教你當沖，新手也能輕鬆跟上，套牢也能幫你解套";

test("10/27 投顧一對一引流＋外部連結：直接通知（只通知）", () => {
  for (const t of [`${AD} https://abc.example-short.me/xyz`, `${AD}\nexample.top/a1`, "股市老師免費診股 加我LINE", "資深分析師一對一帶當沖 賴:abc123", `投 顧 分 析 師 一 對 一 https://x.example.xyz/q`]) assert.ok(has(t), t);
  const r = notifyScore(`${AD} https://abc.example-short.me/xyz`, scam);
  assert.equal(r.notify, true);
});

test("10/27 投顧引流：一般投資分享、主流網址、沒引流字眼、沒連結都不算", () => {
  for (const t of [
    "分析師說台積電下季營收會成長 https://news.cnyes.com/news/id/1",
    "這個分析師的影片不錯 https://youtu.be/abcdefg",
    "投顧分析師一對一？聽起來怪怪的",
    `${AD}`,
    "分析師報告 https://example.org/report.pdf",
    "派網網格教學 新手也能輕鬆跟隨 https://www.pionex.com/zh-TW/",
    "分析師一對一 https://www.tradingview.com/chart/abc",
  ]) assert.equal(has(t), false, t);
});

test("10/27 投顧引流：白名單／真管理員、雙模型 OK 不算", () => {
  const t = `${AD} https://abc.example-short.me/xyz`;
  assert.equal(has(t, { ...scam, protectedSender: true }), false);
  assert.equal(has(t, { verdict: "OK", review: "OK" }), false);
  assert.ok(has(t, { verdict: "OK", review: "SCAM" }));
  assert.ok(has(t, { verdict: "UNSURE", review: "UNSURE" }));
});

test("10/27 投顧引流（對抗）：詐騙者加防詐提醒字樣，第一層仍判 SCAM 就照通知；第一層沒判 SCAM 的群友轉貼警告不通知", () => {
  const spoof = `小心詐騙！${AD} https://abc.example-short.me/xyz`;
  assert.ok(has(spoof, scam));
  assert.ok(has(`防詐提醒 ${AD} 加我LINE`, { verdict: "SCAM", review: "OK" }));
  const warn = `提醒大家：這種投顧分析師一對一當沖的連結 https://abc.example-short.me/xyz 是詐騙，不要點`;
  assert.equal(has(warn, { verdict: "OK", review: "SCAM" }), false);
  assert.equal(has(`這是詐騙嗎？${AD} https://abc.example-short.me/xyz`, { verdict: "UNSURE" }), false);
});

test("10/27 投顧引流：不進踢人分數、不在踢人群可踢理由；通知附教學", () => {
  const t = `${AD} https://abc.example-short.me/xyz`;
  assert.equal(MINER_KICKABLE.has(ADVISOR_LURE), false);
  assert.equal(ruleScore(t).names.includes(ADVISOR_LURE), false);
  const names = textNotifyReasons({ text: t, chatId: "c1", senderId: "u1", result: { verdict: "SCAM", review: "SCAM", score: 1, names: ["網址"] }, tracker: makeNotifyTracker() });
  assert.ok(names.includes(ADVISOR_LURE));
  assert.ok(noticeTips([ADVISOR_LURE]).length === 1);
});
