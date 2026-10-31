import { test } from "node:test";
import assert from "node:assert/strict";
import { intelNotify1025, INTEL_MOVE3, INTEL_SUBSHORT, INTEL_VOTE_COUPON, textNotifyReasons, makeNotifyTracker } from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

const f = (t, o) => intelNotify1025(t, o);
test("換群三段式：正例（含字間空白、全形、社群邀請）", () => {
  assert.deepEqual(f("本群明天將解散，請大家加入新群 https://bit.ly/Ab12cd"), [INTEL_MOVE3]);
  assert.ok(f("群　組 即 將 刪 除 ，請 加 入 新 社 群 https://line.me/ti/g2/EXAMPLE").includes(INTEL_MOVE3));
  assert.ok(f("ＢＩＴ．ＬＹ 不算；本群將關閉，前往新群組 https://reurl.cc/Xy12Z").includes(INTEL_MOVE3));
});
test("換群三段式：反例（缺一段、防詐提醒、這是詐騙嗎、真管理員）", () => {
  assert.deepEqual(f("本群明天將解散，請加入新群"), []);
  assert.deepEqual(f("請加入新群 https://bit.ly/Ab12cd"), []);
  assert.deepEqual(f("提醒：說群要解散叫你加入新群 https://bit.ly/Ab12cd 的是詐騙"), []);
  assert.deepEqual(f("這是詐騙嗎？本群將解散加入新群 https://bit.ly/Ab12cd"), []);
  assert.deepEqual(f("本群明天將解散，請大家加入新群 https://bit.ly/Ab12cd", { protectedSender: true }), []);
  assert.deepEqual(f("本群將解散，加入新群看影片 https://youtu.be/abcdef"), []);
});
test("子網域短網址＋短代碼：正反例", () => {
  assert.deepEqual(f("看這個 https://abc.reurl.cc/Xy12Z"), [INTEL_SUBSHORT]);
  assert.deepEqual(f("https://reurl.cc/Xy12Z"), []);
  assert.deepEqual(f("https://www.bit.ly/Xy12Z"), []);
  assert.deepEqual(f("https://abc.reurl.cc/some/long/path/page.html"), []);
  assert.deepEqual(f("https://m.youtube.com/watch"), []);
  assert.deepEqual(f("小心 https://abc.reurl.cc/Xy12Z 是詐騙"), []);
});
test("投票／領券：正反例", () => {
  assert.deepEqual(f("幫我投票 https://vote.example.test/a"), [INTEL_VOTE_COUPON]);
  assert.deepEqual(f("領取飲料券，驗證碼傳給我"), [INTEL_VOTE_COUPON]);
  assert.deepEqual(f("拉票！https://bit.ly/Ab12cd"), [INTEL_VOTE_COUPON]);
  assert.deepEqual(f("投票截止了喔"), []);
  assert.deepEqual(f("幫我投票 https://www.youtube.com/watch?v=abc"), []);
  assert.deepEqual(f("投票表單 https://forms.gle/abc123"), []);
  assert.deepEqual(f("派網投票活動，驗證碼傳給我"), []);
  assert.deepEqual(f("不要相信領飲料券要你回傳驗證碼的訊息"), []);
  assert.deepEqual(f("幫我投票 https://vote.example.test/a", { protectedSender: true }), []);
});
test("textNotifyReasons 帶出新規則；踢人計分不受影響", () => {
  const text = "本群明天將解散，請大家加入新群 https://bit.ly/Ab12cd";
  const names = textNotifyReasons({ text, chatId: "c", senderId: "s", result: { verdict: "OK", names: [] }, tracker: makeNotifyTracker(), shorteners: SHORTENERS });
  assert.ok(names.includes(INTEL_MOVE3));
  assert.deepEqual(textNotifyReasons({ text, chatId: "c", senderId: "s", result: { verdict: "OK", names: [] }, tracker: makeNotifyTracker(), shorteners: SHORTENERS, protectedSender: true }).filter((n) => n === INTEL_MOVE3), []);
  assert.ok(typeof makeRuleScorer === "function");
});
