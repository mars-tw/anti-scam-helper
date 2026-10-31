import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES, SHORTENERS } from "../guard/rules.mjs";

const rule = (name) => RULES.find((r) => r.name === name);
test("supr.link 算短網址", () => {
  assert.ok(SHORTENERS.includes("supr.link"));
  assert.match("快來 https://supr.link/abcde", rule("短網址").pattern);
  assert.doesNotMatch("mysupr.link/abc", rule("短網址").pattern);
});
test("假冒官方邀請入群：命中與不命中", () => {
  const p = rule("假冒官方邀請入群").pattern;
  for (const t of ["某某旅行社官方誠邀您加入VIP福利群", "品牌官方 LINE 社群開放免費加入", "官方福利群點此加入 supr.link/x"]) assert.match(t, p, t);
  for (const t of ["Claude 官方文件有寫", "我加入了一個 Codex 討論群", "公司今天放假"]) assert.doesNotMatch(t, p, t);
  assert.equal(rule("假冒官方邀請入群").score, 2);
});

import { makeRuleScorer } from "../guard/rules.mjs";
const ruleScore = makeRuleScorer();
test("自稱官方卻導向群組／社群／個人帳號 → 加重；@ 官方帳號只減分", () => {
  const p = rule("官方名義導向群組").pattern;
  for (const t of ["某旅行社官方福利群 https://line.me/ti/g2/AbCdEf", "銀行客服請加 line.me/ti/g/xyz", "品牌官方 line.me/ti/p/~someone"]) assert.match(t, p, t);
  for (const t of ["品牌官方 https://line.me/R/ti/p/@brand", "https://line.me/ti/g2/AbCdEf 一起討論 Codex"]) assert.doesNotMatch(t, p, t);
  const off = rule("LINE 官方帳號連結");
  assert.equal(off.score, -1);
  assert.match("https://line.me/R/ti/p/@brand", off.pattern);
});

test("評分：官方名義＋群組邀請比 @ 官方帳號高，@ 只減分不歸零", () => {
  const bad = ruleScore({}, "某旅行社官方福利群開放加入 https://line.me/ti/g2/AbCdEf");
  const ok = ruleScore({}, "某旅行社官方帳號 https://line.me/R/ti/p/@brand");
  assert.ok(bad.names.includes("官方名義導向群組") && bad.names.includes("假冒官方邀請入群"));
  assert.ok(ok.names.includes("LINE 官方帳號連結"));
  assert.ok(ok.score > 0, "@ 官方帳號不是白名單");
  assert.ok(bad.score > ok.score);
});
