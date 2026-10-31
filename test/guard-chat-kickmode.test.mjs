import { test } from "node:test";
import assert from "node:assert/strict";
import { kickModeFor } from "../guard/policy.mjs";

test("每群 kickMode 覆寫：只有設 kick 的群踢，其他跟全域", () => {
  const groupPolicies = { a: { kickMode: "kick" }, b: { mention: false }, c: { kickMode: "kick", warnOnly: true }, d: { kickMode: "kick", learnOnly: true }, e: { kickMode: "yes" } };
  assert.equal(kickModeFor("a", { globalMode: "notify", groupPolicies }), "kick");
  for (const id of ["b", "c", "d", "e", "zzz"]) assert.equal(kickModeFor(id, { globalMode: "notify", groupPolicies }), "notify", id);
  assert.equal(kickModeFor("b", { globalMode: "kick", groupPolicies }), "kick");
  assert.equal(kickModeFor("a", {}), "notify");
});

import { decideChatKick } from "../guard/policy.mjs";
test("踢人群踢人條件：四種情況", () => {
  const base = { score: 7, strongScore: 6, verdict: "SCAM", model: "claude-haiku-5-5" };
  assert.equal(decideChatKick({ ...base, review: "SCAM" }), "kick", "Claude SCAM＋Meta SCAM → 踢");
  assert.equal(decideChatKick({ ...base, review: undefined }), "kick", "Meta 空回應／逾時／錯誤 → 照踢");
  assert.equal(decideChatKick({ ...base, review: "UNAVAILABLE" }), "kick");
  assert.equal(decideChatKick({ ...base, review: "OK" }), "notice", "Meta 明確非詐騙 → 只通知");
  assert.equal(decideChatKick({ ...base, review: "UNSURE" }), "notice");
  assert.equal(decideChatKick({ ...base, model: "muse-spark-1.3-contributor", review: "SCAM" }), "notice", "第一層只剩 Meta → 只通知");
  assert.equal(decideChatKick({ ...base, model: "none", review: undefined }), "notice");
  assert.equal(decideChatKick({ ...base, score: 5, review: "SCAM" }), undefined, "分數不夠交回一般流程");
  assert.equal(decideChatKick({ ...base, verdict: "UNSURE", review: "SCAM" }), undefined);
});
