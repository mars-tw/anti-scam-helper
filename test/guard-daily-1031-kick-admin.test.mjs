import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decideAction,
  selfIsChatAdmin,
  scanNotifyDecision,
  normalizeLogDecision,
  countActualActions,
  kickModeFor,
} from "../guard/policy.mjs";

/** 三種群：踢人／非踢人／Hao0321 只警告（與既有日測一致） */
const THREE = [
  { kickMode: "notify", label: "踢人群" },
  { kickMode: "off", label: "非踢人群" },
  { kickMode: "notify", label: "Hao0321 只警告群", warnOnly: true },
];

test("10/31 m9bcae：一般連結 score1＋names 網址 → 三種群都 notice，不是 delete／kick", () => {
  for (const g of THREE) {
    // scanNotify／無權限群：canDelete=false → 不可 delete
    assert.equal(
      decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true, canDelete: false }),
      "notice",
      g.label + " canDelete=false",
    );
    // 即使本帳能刪，一般連結仍走 notice；真正刪不刪由 ordinaryLinkScoreOnly／flagScanNotify 擋
    assert.equal(
      decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true, deleteOnLink: true, canDelete: true }),
      "delete",
      g.label + " decideAction 仍可回 delete（主路徑再被 ordinaryLinkScoreOnly 改成 link-score）",
    );
    assert.equal(scanNotifyDecision("delete"), "notify", g.label);
    assert.equal(scanNotifyDecision("notice"), "notify", g.label);
    const mode = kickModeFor(g.label, {
      globalMode: "notify",
      groupPolicies: { [g.label]: { kickMode: g.kickMode, ...(g.warnOnly ? { warnOnly: true } : {}) } },
    });
    assert.notEqual(mode, "kick", g.label);
  }
});

test("舊日誌 action=delete＋scanNotify：normalize 後不算真刪；計數不進 deleted", () => {
  const old = { action: "delete", scanNotify: true, verdict: "SCAM", score: 1, names: ["網址"], kick: false, link: true };
  const n = normalizeLogDecision(old);
  assert.equal(n.action, "none");
  assert.equal(n.decision, "delete");
  assert.deepEqual(countActualActions([old, { action: "notified", kind: "suspect" }, { action: "suspect-flag", scanNotify: true }]), {
    deleted: 0,
    kicked: 0,
    notified: 1,
  });
});

test("selfIsChatAdmin：成功踢／刪後補記 role 才算可踢；空 Map／無 role 不算", () => {
  const selfId = "self-mid";
  const isSelf = (id) => id === selfId;
  assert.equal(selfIsChatAdmin(new Map(), isSelf), false);
  assert.equal(selfIsChatAdmin(new Map([[selfId, { name: "me" }]]), isSelf), false);
  assert.equal(selfIsChatAdmin(new Map([[selfId, { name: "me", role: "coAdmin" }]]), isSelf), true);
  assert.equal(selfIsChatAdmin(new Map([["other", { role: "admin" }]]), isSelf), false);
});

test("踢人計數：kickSent 不算；只有 removed 算；kickFailed 不算", () => {
  assert.deepEqual(
    countActualActions([
      { action: "impersonation-invite-handled", kickSent: true, deleted: 2 },
      { action: "removed" },
      { action: "kickFailed", code: "FORBIDDEN" },
      { action: "failed", code: "FORBIDDEN" },
      { action: "scam-shop-handled", kickSent: true },
    ]),
    { deleted: 2, kicked: 1, notified: 0 },
  );
});

test("guard 源碼：markSelfCanKick／kickFailed／flagScanNotify link-score-only", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /function markSelfCanKick/);
  assert.match(src, /self-admin-inferred/);
  assert.match(src, /markSelfCanKick\(entry\.chatId, "member-removed"\)/);
  assert.match(src, /action: "kickFailed"/);
  assert.match(src, /kind === "link-score" \? "link-score-only" : "suspect-flag"/);
  assert.match(src, /kickSent＝已送出請求/);
  // 不可再靠 kickSent 當已踢計數（註解說明＋實作只 if removed）
  const policy = readFileSync(new URL("../guard/policy.mjs", import.meta.url), "utf8");
  assert.match(policy, /踢人只計 API 確認的 removed/);
  const body = policy.match(/export function countActualActions\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(body, /if \(a === "removed"\) out\.kicked/);
  assert.equal(/kickSent\s*\)/.test(body) || /e\.kickSent/.test(body), false);
});
