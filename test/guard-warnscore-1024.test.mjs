import test from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer } from "../guard/rules.mjs";

const score = makeRuleScorer();
const msg = { senderName: "測試成員" };

test("防詐提醒、無連結：疑似假群組不加分", () => {
  const r = score(msg, "疑似詐騙提醒：有人說要換新群，大家不要亂加");
  assert.ok(r.names.includes("疑似假群組"));
  assert.equal(r.score, 0);
});
test("防詐提醒、無連結：盜帳號／收帳戶不加分", () => {
  const r = score(msg, "小心詐騙！有人要你提供驗證碼，千萬不要給");
  assert.ok(r.names.includes("盜帳號／收帳戶"));
  assert.equal(r.score, 0);
});
test("有連結時照常計分", () => {
  const r = score(msg, "疑似詐騙？換新群 https://example.invalid/abc");
  assert.ok(r.names.includes("疑似假群組"));
  assert.ok(r.score >= 3);
});
test("沒有提醒語氣時照常計分", () => {
  const r = score(msg, "大家換新群喔，請提供驗證碼給我");
  assert.ok(r.score >= 6);
});
test("有加好友 ID 時照常計分", () => {
  const r = score(msg, "小心詐騙，換新群 ID: testid123");
  assert.ok(r.names.includes("疑似假群組"));
  assert.equal(r.score, 2); // 3 加好友 + 3 疑似假群組 - 4 提醒（有連結時不歸零）
});
test("假群組公告不受影響", () => {
  const r = score(msg, "小心詐騙，群組搬家到備用群");
  assert.ok(r.names.includes("假群組公告"));
  assert.ok(r.score > 0);
});
