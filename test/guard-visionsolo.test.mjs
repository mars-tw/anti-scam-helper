import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visionHasLink, visionSoloMayNotify, decideChatKick, isFakeGroupImage } from "../guard/policy.mjs";

test("看圖單一模型：按鈕字樣、泛稱「連結」不算連結", () => {
  assert.equal(visionHasLink("圖中有「Verify & Request Access」連結，誘導填表驗證並索取資料"), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: undefined }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "UNAVAILABLE" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "OK" }), false);
  assert.equal(visionSoloMayNotify({ reason: "圖中有申請按鈕，誘導填表", review: "UNSURE" }), false);
});
test("看圖單一模型：覆核確認 SCAM 才通知", () => {
  assert.equal(visionSoloMayNotify({ reason: "誘導填表驗證並索取資料", review: "SCAM" }), true);
});
test("看圖單一模型：有網址／短網址／QR／LINE ID／群組邀請照舊通知", () => {
  for (const reason of ["圖中有網址 example.com 要求匯款", "圖中有短網址引流", "圖中有QR碼要掃碼入群", "要求加LINE好友領取", "附 LINE ID 私訊老師", "群組邀請連結導流"]) {
    assert.equal(visionHasLink(reason), true, reason);
  }
  assert.equal(visionSoloMayNotify({ reason: "誘導填表", qr: true }), true);
});
test("踢人規則不受影響：礦工群短網址展開群組邀請＋一般成員＋覆核 SCAM 照踢", () => {
  assert.equal(decideChatKick({ score: 0, verdict: "UNSURE", review: "SCAM", expandedInvite: true, ordinaryMember: true }), "kick");
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-x", review: "SCAM" }), "kick");
  assert.equal(isFakeGroupImage("請原成員轉移到新群"), true);
});
test("guard：單一看圖 SCAM 無連結無覆核 → 只記錄 vision-solo-skip，不算標記", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.equal((src.match(/action: "vision-solo-skip"/g) ?? []).length, 2);
  const flag = src.match(/const FLAG_ACTIONS = (\/.*\/);/)[1];
  assert.equal(new RegExp(flag.slice(1, -1)).test("vision-solo-skip"), false);
});
