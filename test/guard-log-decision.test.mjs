import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  withLogDecision,
  normalizeLogDecision,
  countActualActions,
  DECISION_ONLY_ACTIONS,
} from "../guard/policy.mjs";

test("withLogDecision：決策寫進 decision，action 只留實際執行", () => {
  const entry = { action: "notice", verdict: "SCAM", score: 3, names: ["加LINE"] };
  assert.deepEqual(withLogDecision(entry, "none"), {
    action: "none",
    decision: "notice",
    verdict: "SCAM",
    score: 3,
    names: ["加LINE"],
  });
  assert.deepEqual(withLogDecision({ action: "delete", messageId: "1" }, "none").action, "none");
  assert.equal(withLogDecision({ action: "delete", messageId: "1" }, "none").decision, "delete");
  assert.equal(withLogDecision({ action: "kick" }, "none").decision, "kick");
  assert.equal(withLogDecision({ action: "none", score: 1 }, "none").decision, "none");
  // 已有 decision 時以 decision 為準，不覆蓋實際動作
  assert.deepEqual(withLogDecision({ action: "notice", decision: "delete" }, "scam-link-deleted"), {
    action: "scam-link-deleted",
    decision: "delete",
  });
});

test("normalizeLogDecision：舊日誌 notice／delete／kick 改寫成 decision＋action none", () => {
  assert.ok(DECISION_ONLY_ACTIONS.has("notice"));
  assert.ok(DECISION_ONLY_ACTIONS.has("delete"));
  assert.ok(DECISION_ONLY_ACTIONS.has("kick"));
  assert.deepEqual(normalizeLogDecision({ action: "notice", verdict: "SCAM" }), {
    action: "none",
    decision: "notice",
    verdict: "SCAM",
  });
  assert.deepEqual(normalizeLogDecision({ action: "delete" }), { action: "none", decision: "delete" });
  // 已是實際動作：補 decision＝原 action，不改 action
  assert.deepEqual(normalizeLogDecision({ action: "notified" }), { action: "notified", decision: "notified" });
  assert.deepEqual(normalizeLogDecision({ action: "removed", decision: "kick" }), {
    action: "removed",
    decision: "kick",
  });
  // 新格式已有 decision 且 action 不是決策值：原樣
  assert.deepEqual(normalizeLogDecision({ action: "none", decision: "notice" }), {
    action: "none",
    decision: "notice",
  });
});

test("countActualActions：只計實際刪／踢／群內通知，不算 decision 與誤寫 notice／delete", () => {
  const rows = [
    { action: "notice", verdict: "SCAM" }, // 舊誤寫判斷列
    { action: "delete", verdict: "SCAM" },
    { action: "none", decision: "notice" }, // 新格式判斷列
    { action: "notified", kind: "suspect" },
    { action: "note-notified" },
    { action: "removed" },
    { action: "scam-link-deleted", notified: true },
    { action: "unrecognized-link-deleted" },
    { action: "followup-deleted" },
    { action: "scam-shop-handled", deleted: true, kickSent: false },
    { action: "scam-shop-handled", kickSent: true },
    { action: "impersonation-invite-handled", deleted: 2, kickSent: true },
    { action: "suspect-flag" }, // 標記不算通知
  ];
  assert.deepEqual(countActualActions(rows), {
    deleted: 3 + 1 + 2, // scam-link + unrecognized + followup + shop deleted + invite deleted(2)
    kicked: 1 + 1 + 1, // removed + shop kick + invite kick
    notified: 2, // notified + note-notified
  });
});

test("guard：判斷紀錄用 withLogDecision，動作欄不再被 entry.action 蓋成 notice／delete", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /withLogDecision/);
  // 主路徑與 scanNotify 判斷列必須用 helper
  assert.match(src, /record\(withLogDecision\(\{ scanNotify: true, \.\.\.entry \}, "none"\)\)/);
  assert.match(src, /record\(withLogDecision\(entry, "none"\)\)/);
  // 不該再出現會被 spread 蓋掉的寫法
  assert.equal((src.match(/record\(\{\s*action:\s*"none",\s*\.\.\.entry/g) ?? []).length, 0);
  assert.equal((src.match(/record\(\{\s*action:\s*"none",[^)]*\.\.\.entry\s*\}\)/g) ?? []).length, 0);
});
