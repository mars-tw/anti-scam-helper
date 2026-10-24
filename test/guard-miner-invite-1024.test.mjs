import test from "node:test";
import assert from "node:assert/strict";
import { decideChatKick } from "../guard/policy.mjs";

const base = { score: 6, strongScore: 6, model: "claude-test", expandedInvite: true, ordinaryMember: true };

test("展開為群組邀請＋一般成員＋覆核 SCAM＋第一層 UNSURE → 踢", () => {
  assert.equal(decideChatKick({ ...base, verdict: "UNSURE", review: "SCAM" }), "kick");
});
test("第一層 SCAM＋覆核 SCAM → 踢", () => {
  assert.equal(decideChatKick({ ...base, verdict: "SCAM", review: "SCAM" }), "kick");
});
test("第一層明確 OK → 不踢", () => {
  assert.notEqual(decideChatKick({ ...base, verdict: "OK", review: "SCAM" }), "kick");
});
test("覆核非 SCAM（OK／UNSURE）→ 不踢", () => {
  assert.notEqual(decideChatKick({ ...base, verdict: "UNSURE", review: "OK" }), "kick");
  assert.notEqual(decideChatKick({ ...base, verdict: "UNSURE", review: "UNSURE" }), "kick");
});
test("覆核失敗／逾時／空白 → 不踢（第一層 UNSURE）", () => {
  for (const review of [undefined, "UNAVAILABLE", ""]) assert.notEqual(decideChatKick({ ...base, verdict: "UNSURE", review }), "kick");
});
test("展開失敗（沒有確認是邀請）→ 不走例外", () => {
  assert.notEqual(decideChatKick({ ...base, expandedInvite: false, verdict: "UNSURE", review: "SCAM" }), "kick");
});
test("管理員／白名單（非一般成員）→ 不走例外", () => {
  assert.notEqual(decideChatKick({ ...base, ordinaryMember: false, verdict: "UNSURE", review: "SCAM" }), "kick");
});
test("原本規則不變：第一層 SCAM＋覆核 OK → 通知", () => {
  assert.equal(decideChatKick({ score: 6, strongScore: 6, model: "claude-test", verdict: "SCAM", review: "OK" }), "notice");
});
