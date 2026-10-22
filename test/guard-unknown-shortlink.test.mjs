import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES, SHORTENERS, makeRuleScorer } from "../guard/rules.mjs";
import { isFakeGroupImage } from "../guard/policy.mjs";

const ruleScore = makeRuleScorer();
test("清單內短網址", () => {
  assert.ok(SHORTENERS.includes("bit.ly"));
  assert.ok(ruleScore({}, "https://bit.ly/r/AbC").names.includes("短網址"));
});
test("未知短網址：短網域＋短代碼給基本分；一般網站與清單內不重複", () => {
  for (const t of ["https://ab.cd/r/XyZ12", "qq.to/Ab3"]) assert.ok(ruleScore({}, t).names.includes("疑似短網址"), t);
  for (const t of ["https://github.com/a/b", "see x.ai/blog", "https://docs.ab.io/guide/install", "youtu.be/abc123", "https://amzn.to/3xYz", "https://b23.tv/AbCd1", "https://example.com/r/abc", "bit.ly/abc"]) assert.ok(!ruleScore({}, t).names.includes("疑似短網址"), t);
  assert.equal(RULES.find((r) => r.name === "疑似短網址").score, 2);
});
test("催促加入新群", () => {
  for (const t of ["還沒加入的成員請儘快申請進群哦", "請原成員儘快轉移到新群", "新群重新審核成員"]) assert.ok(ruleScore({}, t).names.includes("催促加入新群"), t);
  for (const t of ["我剛加入這個群", "群組設定在哪裡"]) assert.ok(!ruleScore({}, t).names.includes("催促加入新群"), t);
});
test("暱稱帶「群管」算自稱管理員；真管理員（senderRole）不算", () => {
  assert.ok(ruleScore({ senderName: "群管小明" }, "還沒加入的請儘快進群").names.includes("暱稱冒稱群管"));
  assert.ok(!ruleScore({ senderName: "群管小明", senderRole: "admin" }, "還沒加入的請儘快進群").names.some((n) => n.startsWith("暱稱")));
});
test("圖片假搬家公告會被認出（沒 QR 也通知）", () => {
  assert.ok(isFakeGroupImage("圖中要求原成員轉移到新群，無QR或連結"));
  assert.ok(isFakeGroupImage("新群重新審核成員的通知"));
  assert.ok(!isFakeGroupImage("終端機畫面，群組設定說明"));
});

test("仿冒精品＋數字子網域短路徑", () => {
  const r = ruleScore({}, "頂級 1:1 複刻產品 6786.example.net/ck3");
  assert.ok(r.names.includes("仿冒精品連結") && r.names.includes("數字子網域短路徑"));
  assert.ok(!ruleScore({}, "這個複刻版遊戲很好玩").names.includes("仿冒精品連結"));
  assert.ok(!ruleScore({}, "https://www.example.com/docs/intro").names.includes("數字子網域短路徑"));
});
test("假群組通知（解散、移至二群）＋免費子網域", () => {
  const r = ruleScore({}, "📢【群組通知】原群組即將解散，後續統一移至「二群」，請大家記得加入二群 foo.eu.cc/AbC12/");
  assert.ok(r.names.includes("假群組連結"), r.names.join());
  assert.ok(r.names.includes("免費子網域"));
  assert.ok(!ruleScore({}, "europe.cc 是什麼").names.includes("免費子網域"));
});
test("已知詐騙網域只來自本機設定，含子網域", () => {
  const s = makeRuleScorer(undefined, { scamDomains: ["bad.example"] });
  assert.ok(s({}, "看 123.bad.example/x").names.includes("已知詐騙網域"));
  assert.ok(!s({}, "notbad.example/x").names.includes("已知詐騙網域"));
  assert.ok(!ruleScore({}, "123.bad.example/x").names.includes("已知詐騙網域"));
});
