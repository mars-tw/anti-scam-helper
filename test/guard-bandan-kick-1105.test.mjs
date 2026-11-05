// 士軒 11/5 19:57–19:59：帶單老師 LINE@ 過 strong-gate 時要踢。純函式層對抗測試。
import assert from "node:assert/strict";
import test from "node:test";
import { BANDAN_LINE_OA, bandanLineOaAction, isBandanLineOa } from "../guard/line-oa-bandan.mjs";
import { kickScopeDecision, KICK_BANDAN, KICK_CATEGORIES } from "../guard/kick-scope.mjs";
import { outboundGate } from "../guard/strong-gate.mjs";

test("踢人群＋過閘＋有權限 → kick", () => {
  assert.deepEqual(bandanLineOaAction({ kick: true, strong: true, canDelete: true }), { kick: true, delete: true, notice: true, reason: "kick" });
});
test("沒過閘、沒權限、受保護、非踢人模式 → 不踢", () => {
  assert.equal(bandanLineOaAction({ kick: true, strong: false, canDelete: true }).kick, false);
  assert.equal(bandanLineOaAction({ kick: true, strong: true, canDelete: false }).kick, false);
  assert.equal(bandanLineOaAction({ kick: true, strong: true, canDelete: true, protectedSender: true }).kick, false);
  assert.equal(bandanLineOaAction({ kick: false, strong: true, canDelete: true }).kick, false);
});
test("warnOnly／excludeChat／learnOnly 優先於踢人", () => {
  assert.equal(bandanLineOaAction({ kick: true, strong: true, canDelete: true, warnOnly: true }).reason, "warn-only");
  assert.equal(bandanLineOaAction({ kick: true, strong: true, canDelete: true, excludeChat: true }).reason, "kick-scope-excluded");
  assert.equal(bandanLineOaAction({ kick: true, strong: true, canDelete: true, learnOnly: true }).reason, "learn-only");
});
test("帶單 LINE@ 命中 → strong-gate 有效分數 ≥6", () => {
  const g = outboundGate({ names: [BANDAN_LINE_OA], score: 4 }, { text: "x" });
  assert.equal(g.send, true);
  assert.ok(g.score >= 6);
});
test("kickScopeDecision：bandanKick 只在旗標開時成類別；排除群仍不踢；不進一般 KICK_CATEGORIES", () => {
  assert.equal(KICK_CATEGORIES.includes(KICK_BANDAN), false);
  assert.deepEqual(kickScopeDecision({ chatId: "cA", bandanKick: true, names: [BANDAN_LINE_OA] }), { kick: true, category: KICK_BANDAN });
  assert.equal(kickScopeDecision({ chatId: "cA", names: [BANDAN_LINE_OA] }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cA", bandanKick: true, scope: { excludeChats: ["cA"] } }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cA", bandanKick: true, scope: { warnOnly: new Set(["cA"]) } }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cA", bandanKick: true, excluded: true }).kick, false);
});
test("對抗：交易所官方正常跟單、商家促銷、一般心得 → 不算帶單 LINE@", () => {
  for (const t of [
    "幣安官方帳號 lin.ee/abc 跟單交易教學",
    "OKX 官方 LINE 帳號 https://lin.ee/okxtw 跟單功能上線公告",
    "加官方帳號 @shopabc 雙11 穩賺優惠",
    "全家官方帳號 https://lin.ee/famima 限時優惠 買一送一",
    "分享一下今天跟單心得，BTC 小賺，沒加任何帳號",
  ]) assert.equal(isBandanLineOa(t), false, t);
});
