import assert from "node:assert/strict";
import test from "node:test";
import { cleanupAllowed, cleanupTargets, qrResultKind, visionLureKick } from "../guard/kick-cleanup.mjs";
import { kickCategory, KICK_SCAM_GROUP } from "../guard/kick-scope.mjs";
import { isLineInvite } from "../guard/qr.mjs";

const NOW = Date.parse("2026-11-05T13:00:00Z");
const at = (h) => new Date(NOW - h * 3600_000).toISOString();
test("cleanupTargets：只挑同群同人、24h 內、被標過、未刪、非本則", () => {
  const recs = [
    { at: at(1), action: "suspect-flag", chatId: "cA", senderId: "p", messageId: "a" },
    { at: at(2), action: "vision-flag", chatId: "cA", senderId: "p", messageId: "b" },
    { at: at(3), action: "bandan-line-oa-flag", chatId: "cA", senderId: "p", messageId: "c" },
    { at: at(3), action: "bandan-line-oa-deleted", chatId: "cA", senderId: "p", messageId: "c" },
    { at: at(25), action: "suspect-flag", chatId: "cA", senderId: "p", messageId: "old" },
    { at: at(1), action: "suspect-flag", chatId: "cB", senderId: "p", messageId: "otherChat" },
    { at: at(1), action: "suspect-flag", chatId: "cA", senderId: "q", messageId: "otherMan" },
    { at: at(1), action: "link-score-only", chatId: "cA", senderId: "p", messageId: "scoreOnly" },
    { at: at(1), action: "none", chatId: "cA", senderId: "p", messageId: "normal" },
    { at: at(0.5), action: "flagged", chatId: "cA", senderId: "p", messageId: "self" },
  ];
  assert.deepEqual(cleanupTargets(recs, { chatId: "cA", senderId: "p", exceptIds: ["self"], now: NOW }), ["b", "a"]);
  assert.deepEqual(cleanupTargets(recs, { chatId: "cA", senderId: "p", now: NOW, limit: 1 }), ["b"]);
  assert.deepEqual(cleanupTargets(recs, { chatId: "cA" }), []);
});
test("cleanupAllowed：排除群、只警告、只學習、受保護都不清", () => {
  assert.equal(cleanupAllowed({ chatId: "c", senderId: "p" }), true);
  assert.equal(cleanupAllowed({ chatId: "c", senderId: "p", excludeChats: ["c"] }), false);
  assert.equal(cleanupAllowed({ chatId: "c", senderId: "p", warnOnly: new Set(["c"]) }), false);
  assert.equal(cleanupAllowed({ chatId: "c", senderId: "p", learnOnly: new Set(["c"]) }), false);
  assert.equal(cleanupAllowed({ chatId: "c", senderId: "p", protectedSender: true }), false);
});
test("qrResultKind 分類", () => {
  const t = ["KnownBad0001"];
  assert.equal(qrResultKind(undefined), "none");
  assert.equal(qrResultKind("https://line.me/ti/g2/KnownBad0001", { tickets: t, isLineInvite }), "known-scam-invite");
  assert.equal(qrResultKind("https://line.me/ti/g2/Other1234", { tickets: t, isLineInvite }), "line-group-invite");
  assert.equal(qrResultKind("https://openchat.line.me/tw/cover/KnownBad0001", { tickets: t, isLineInvite }), "known-scam-invite");
  assert.equal(qrResultKind("https://line.me/ti/p/@shop", { tickets: t, isLineInvite }), "line-friend-or-oa");
  assert.equal(qrResultKind("https://www.binance.com/zh-TC/register?ref=1", { tickets: t, isLineInvite }), "url");
  assert.equal(qrResultKind("WIFI:S:x;;", { tickets: t, isLineInvite }), "other");
});
test("kickCategory：已知詐騙邀請碼＋群組邀請 → 詐騙群組；沒有群組邀請不算；交易所官方／商家 QR 不算", () => {
  assert.equal(kickCategory({ qrContent: "https://line.me/ti/g2/KnownBad0001", knownScamInvite: true }), KICK_SCAM_GROUP);
  assert.equal(kickCategory({ qrContent: "https://line.me/ti/p/@shop", knownScamInvite: true }), undefined);
  assert.equal(kickCategory({ qrContent: "https://line.me/ti/g2/Normal0001" }), undefined);
  assert.equal(kickCategory({ qrContent: "https://www.okx.com/join/123" }), undefined);
  assert.equal(kickCategory({ qrContent: "https://lin.ee/famima", text: "全家官方帳號 限時優惠" }), undefined);
});

test("visionLureKick：要 SCAM 且有引流字眼；公告／活動／促銷、不確定、受保護都不算", () => {
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "帶單老師要大家加 LINE" }), true);
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "假投資截圖，叫人進群" }), true);
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "假投資獲利截圖" }), false);
  assert.equal(visionLureKick({ verdict: "UNSURE", reason: "帶單進群" }), false);
  assert.equal(visionLureKick({ verdict: "SCAM_WEAK", reason: "帶單進群" }), false);
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "幣安官方公告：加入官方群組" }), false);
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "週年慶促銷，加 LINE 好友" }), false);
  assert.equal(visionLureKick({ verdict: "SCAM", reason: "帶單進群", protectedSender: true }), false);
});
