import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnowledgePage, reviewOnlyScam } from "../guard/notify-rules.mjs";
import { makeRuleScorer, RULES } from "../guard/rules.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";

// 16:31 誤判：403 字分享台灣技術社群的訊息＋短網域連結；第一層 Claude OK、覆核 Grok SCAM → 被強制通知並標記 3 人。
const TEXT = "整理了一份台灣技術社群清單，給想找聚會、年會、開源專案的朋友參考：" + "前端、後端、資料、資安、AI 各領域都有，".repeat(8) + " 完整列表在這 ab.tw/xyz";
const resolve = async () => [{ address: "93.184.216.34" }];
const page = (html) => async () => ({ status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html" : null) }, body: { getReader: () => { let d = false; return { read: async () => (d ? { done: true } : ((d = true), { done: false, value: Buffer.from(html) })), cancel: async () => {} }; } } });

test("原因重現：短網域路徑命中「疑似短網址」（強制判詐騙清單），而它不在已知短網址清單，所以舊版沒展開", () => {
  const { names } = makeRuleScorer()({}, TEXT);
  assert.ok(names.includes("疑似短網址"));
  assert.ok(RULES.find((r) => r.name === "疑似短網址").pattern.test(TEXT));
});
test("修正 1：展開後是社群／技術網站 → 知識，放行（覆核不推翻）", async () => {
  const out = await expandUrlSafe("https://ab.tw/xyz", { fetchImpl: page("<html><head><title>台灣技術社群列表 | Community</title></head></html>"), resolve });
  assert.ok(isKnowledgePage(out.url, out.html));
  assert.ok(isKnowledgePage("https://github.com/x/y", ""));
  assert.equal(isKnowledgePage("https://ab.tw/xyz", "<title>社群團購</title>加入購物車"), false, "購物頁不算");
  assert.equal(isKnowledgePage("https://ab.tw/xyz", "<title>限時優惠</title>"), false);
  // 放行後去掉「疑似短網址」，剩下只有「網址」：第一層 Claude OK＋覆核 SCAM → 只記錄。
  assert.equal(reviewOnlyScam({ verdict: "OK", model: "claude-haiku-5-5", review: "SCAM", names: ["網址"] }), true);
});
test("修正 2：Claude OK、只有覆核 SCAM、無確定特徵 → 只記錄；有確定特徵或第一層非 Claude／非 OK → 照舊", () => {
  const base = { verdict: "OK", model: "claude-haiku-5-5", review: "SCAM" };
  assert.equal(reviewOnlyScam({ ...base, names: ["網址", "投資帶單"] }), true);
  for (const n of ["群組邀請連結", "短網址導向群組邀請", "疑似短網址", "已知詐騙網域"]) assert.equal(reviewOnlyScam({ ...base, names: ["網址", n] }), false, n);
  assert.equal(reviewOnlyScam({ ...base, model: "grok-4.7-build-fast", names: ["網址"] }), false);
  assert.equal(reviewOnlyScam({ ...base, verdict: "SCAM", names: ["網址"] }), false);
  assert.equal(reviewOnlyScam({ ...base, review: "UNSURE", names: ["網址"] }), false);
});
