import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { imageNotify, onlyMainstreamMediaLinks } from "../guard/notify-rules.mjs";
import { isFlagEntry, visionVerdict } from "../guard/policy.mjs";

const FLAG = /^(removed|flagged|failed|notified|suspect-flag|vision-flag|kick-suppressed)/;
const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");

test("看盤／網格／損益截圖本身不通知", () => {
  for (const r of ["交易所合約網格 +247% 獲利截圖，無引流", "投資相關的技術分析圖，包含K線圖和趨勢線", "虛擬貨幣網格機器人畫面，顯示虧損，無引流或收款資訊。", "加密貨幣槓桿倉位對帳單，無引流或索款", "交易軟體畫面，無引流、收款或獲利宣傳"]) {
    for (const v of ["OK", "UNSURE", "SCAM_WEAK"]) assert.equal(imageNotify(v, r).notify, false, `${v} ${r}`);
  }
  assert.ok(imageNotify("UNSURE", "圖中有 +35.86% 獲利、邀請碼與「掃碼立即跟單」QR code，年化+900%").notify, "有 QR 招收照樣通知");
});
test("自相矛盾的 SCAM（說沒有 QR／引流）降級", () => {
  assert.notEqual(visionVerdict("SCAM", "這張圖片是技術分析圖，包含K線圖，無任何QR code、LINE ID、網址"), "SCAM");
});
test("同一人第 2 張獲利圖不再單獨通知", () => {
  assert.match(src, /function trackProfitImage\(inl, message\) \{\n[^\n]*profitImage[^\n]*\n\s*return false;/);
  assert.doesNotMatch(src, /okInl\.profitOnly && notifyTracker\.profitImage/);
});
test("看圖提示：看盤、交易所、網格、損益截圖算 OK", () => {
  assert.match(src, /看盤圖、K 線、技術分析、交易所或交易工具 App 畫面、網格／交易機器人畫面/);
  assert.doesNotMatch(src, /虛擬貨幣的獲利截圖或對帳單，老師帶單/);
});
test("只記錄的看圖結果不算標記（不刪參考資料、不排除整理）", () => {
  assert.equal(isFlagEntry({ action: "vision-flag", verdict: "VISION_UNSURE" }, FLAG), false);
  assert.equal(isFlagEntry({ action: "vision-flag", verdict: "VISION_SCAM_WEAK", scanNotify: true, notified: false }, FLAG), false);
  assert.equal(isFlagEntry({ action: "vision-flag", verdict: "VISION_SCAM" }, FLAG), true);
  assert.equal(isFlagEntry({ action: "vision-flag", verdict: "VISION_UNSURE", scanNotify: true }, FLAG), true, "有發通知的算");
  assert.equal(isFlagEntry({ action: "suspect-flag" }, FLAG), true);
  assert.equal(isFlagEntry({ action: "revoked-suspect-flag" }, FLAG), false);
  assert.equal(isFlagEntry({ action: "none" }, FLAG), false);
});
test("主流交易所／看盤工具網址本身不是依據；仿冒網域不算", () => {
  assert.ok(onlyMainstreamMediaLinks("今天看這張 https://www.tradingview.com/x/abc/"));
  assert.ok(onlyMainstreamMediaLinks("https://www.pionex.com/zh-TW/"));
  assert.ok(!onlyMainstreamMediaLinks("https://pionex.com.example.xyz/a"));
  assert.ok(!onlyMainstreamMediaLinks("https://fakepionex.com/a"));
});
