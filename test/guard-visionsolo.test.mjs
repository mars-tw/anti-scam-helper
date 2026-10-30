import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visionHasLink, visionSoloMayNotify, decideChatKick, isFakeGroupImage, kickModeFor, warnOnlyChats } from "../guard/policy.mjs";

test("看圖單一模型：按鈕字樣、泛稱「連結」不算連結", () => {
  assert.equal(visionHasLink("圖中有「Verify & Request Access」連結，誘導填表驗證並索取資料"), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: undefined }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "UNAVAILABLE" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "OK" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "UNSURE" }), false);
});

test("看圖單一模型：泛稱「網址／縮網址」不算連結（10/30 Pan 群誤通知）", () => {
  assert.equal(visionHasLink("圖中要人訂閱付費並寄到外部信箱，附可疑網址"), false);
  assert.equal(visionHasLink("附可疑網址"), false);
  assert.equal(visionHasLink("圖中有縮網址"), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中要人訂閱付費並寄到外部信箱，附可疑網址", review: undefined }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中要人訂閱付費並寄到外部信箱，附可疑網址", review: "UNAVAILABLE" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中要人訂閱付費並寄到外部信箱，附可疑網址", review: "OK" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中要人訂閱付費並寄到外部信箱，附可疑網址", review: "UNSURE" }), false);
  // 無具體網域／QR：覆核也判 SCAM 才通知
  assert.equal(visionSoloMayNotify({ reason: "圖中要人訂閱付費並寄到外部信箱，附可疑網址", review: "SCAM" }), true);
});

test("看圖單一模型：覆核確認 SCAM 才通知", () => {
  assert.equal(visionSoloMayNotify({ reason: "誘導填表驗證並索取資料", review: "SCAM" }), true);
});

test("看圖單一模型：理由含具體網域或 QR／短網址／LINE 邀請照舊通知", () => {
  for (const reason of [
    "圖中有網址 example.com 要求匯款",
    "附 https://evil.example/pay",
    "圖中有短網址引流",
    "圖中有QR碼要掃碼入群",
    "要求加LINE好友領取",
    "附 LINE ID 私訊老師",
    "群組邀請連結導流",
  ]) {
    assert.equal(visionHasLink(reason), true, reason);
    assert.equal(visionSoloMayNotify({ reason, review: undefined }), true, reason);
  }
  assert.equal(visionSoloMayNotify({ reason: "誘導填表", qr: true }), true);
});

test("對抗：踢人群／非踢人群／Hao0321 只警告群——無具體網域不單模通知；有網域照舊；踢人條件不變", () => {
  const bare = "圖中要人訂閱付費並寄到外部信箱，附可疑網址";
  const withHost = "圖中有 evil-pay.com 要匯款";
  // 三種群政策下，看圖通知門檻相同（visionSoloMayNotify 不依群）；差別在 kickMode／warnOnly
  const policies = {
    cKick: {},
    cNotify: {},
    cWarn1: { warnOnly: true },
    cWarn2: { warnOnly: true },
    cWarn3: { warnOnly: true }, // Hao0321 類三群
  };
  const warn = warnOnlyChats(policies);
  assert.equal(warn.size, 3);
  assert.equal(kickModeFor("cKick", { globalMode: "kick", groupPolicies: policies }), "kick");
  assert.equal(kickModeFor("cNotify", { globalMode: "notify", groupPolicies: policies }), "notify");
  assert.equal(kickModeFor("cWarn1", { globalMode: "kick", groupPolicies: policies }), "kick"); // warnOnly 不改字串，上層擋踢
  // warnOnly 群：kickModeFor 仍回傳全域模式字串，但上層 blockedForWarnOnly／kickScope 擋踢（既有規定）
  for (const chatId of ["cKick", "cNotify", "cWarn1"]) {
    assert.equal(visionHasLink(bare), false, chatId);
    assert.equal(visionSoloMayNotify({ reason: bare, review: undefined }), false, chatId);
    assert.equal(visionSoloMayNotify({ reason: bare, review: "SCAM" }), true, chatId);
    assert.equal(visionHasLink(withHost), true, chatId);
    assert.equal(visionSoloMayNotify({ reason: withHost, review: undefined }), true, chatId);
  }
  // 踢人條件不動
  assert.equal(decideChatKick({ score: 0, verdict: "UNSURE", review: "SCAM", expandedInvite: true, ordinaryMember: true }), "kick");
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-x", review: "SCAM" }), "kick");
  assert.equal(isFakeGroupImage("請原成員轉移到新群"), true);
});

test("踢人規則不受影響：礦工群短網址展開群組邀請＋一般成員＋覆核 SCAM 照踢", () => {
  assert.equal(decideChatKick({ score: 0, verdict: "UNSURE", review: "SCAM", expandedInvite: true, ordinaryMember: true }), "kick");
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-x", review: "SCAM" }), "kick");
  assert.equal(isFakeGroupImage("請原成員轉移到新群"), true);
});

test("guard：單一看圖 SCAM 無連結無覆核 → 只記錄 vision-solo-skip，不算標記；VISION_SYSTEM 含訂閱／帳單 OK 例", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.equal((src.match(/action: "vision-solo-skip"/g) ?? []).length, 2);
  const flag = src.match(/const FLAG_ACTIONS = (\/.*\/);/)[1];
  assert.equal(new RegExp(flag.slice(1, -1)).test("vision-solo-skip"), false);
  assert.match(src, /技術訂閱|API 用量|invoice／帳單/);
  const policy = readFileSync(new URL("../guard/policy.mjs", import.meta.url), "utf8");
  assert.match(policy, /「網址」「縮網址」這種泛稱不算連結/);
  const linkLine = policy.split("\n").find((l) => l.startsWith("const VISION_LINK"));
  assert.ok(linkLine);
  assert.equal(/\|網址\|/.test(linkLine) || /\|網址\//.test(linkLine) || linkLine.includes("|網址|"), false);
  assert.equal(linkLine.includes("縮網址"), false);
  assert.equal(linkLine.includes("短網址"), true); // 具體「短網址」仍保留
});
