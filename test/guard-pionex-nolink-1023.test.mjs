import test from "node:test";
import assert from "node:assert/strict";
import { exchangeTextNoLink, exchangeImageNoLink, outOfScopeNames } from "../guard/exchange-nolink.mjs";

test("交易所相關、沒附連結的文字：只記錄", () => {
  for (const t of ["派網網格今天又賺了一點", "這個合約我開 20 倍，止損設好了", "我的推薦碼是 ABC123 要的自己填", "看起來有入金一點喔", "BTC K線要破前高了", "跟單機器人收益還不錯"]) assert.equal(exchangeTextNoLink(t), true, t);
});
test("附連結或加好友就不豁免", () => {
  for (const t of ["派網註冊 https://example.test/r/abc", "網格教學看 bit.ly/xyz", "跟單請加我 line id: abc123", "合約帶單加賴", "入金送 USDT 私訊我", "派網群 line.me/ti/g2/xxxx"]) assert.equal(exchangeTextNoLink(t), false, t);
});
test("跟交易所無關或假群組／冒充管理員不豁免", () => {
  assert.equal(exchangeTextNoLink("今天天氣很好"), false);
  assert.equal(exchangeTextNoLink("本群有詐騙，管理員已建立新群請轉移，跟單繼續"), false);
  assert.equal(outOfScopeNames(["冒用「管理員身分」"]), true);
  assert.equal(outOfScopeNames(["投資帶單", "同一人 24 小時內第 2 次判詐騙"]), false);
});
test("看圖：交易所／獲利截圖沒附連結 → 只記錄", () => {
  for (const r of ["圖中是合約損益截圖（+157.23%），附派網邀請碼與 QR code。", "圖中為 Pionex 合約網格 +247% 獲利截圖，無引流", "虛擬貨幣獲利截圖（今日+8%），無QR或聯絡方式", "這張圖片是交易軟體的螢幕截圖，顯示加密貨幣的價格圖表，並沒有任何 QR code、LINE ID"]) assert.equal(exchangeImageNoLink(r), true, r);
});
test("看圖：有 LINE／加好友／網址／短網址就照舊", () => {
  for (const r of ["投資廣告，有虛擬貨幣字眼並含 QR code", "獲利截圖，並有 QR code 及加好友／LINE ID", "老師帶單獲利區塊與某網站網址水印", "圖中含可疑短網址，引誘投資比特幣", "獲利截圖＋「掃碼立即跟單」QR", "圖中要求原成員轉移到新群"]) assert.equal(exchangeImageNoLink(r), false, r);
});
