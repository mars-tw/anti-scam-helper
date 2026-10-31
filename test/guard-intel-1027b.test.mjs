import test from "node:test";
import assert from "node:assert/strict";
import { notifyScore, SHIP_VERIFY, SEX_PLATFORM, LUXURY_URL, MINER_KICKABLE, noticeTips } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
const ruleScore = makeRuleScorer();
const scam = { verdict: "SCAM", review: "SCAM" };
const unsure = { verdict: "UNSURE", review: "UNSURE" };
const has = (name, t, ctx = scam) => notifyScore(t, ctx).names.includes(name);

test("10/27b 賣貨便實名認證假客服：任兩個字眼才通知", () => {
  for (const t of ["你的賣貨便訂單要先做實名認證，請聯絡客服", "郵政客服說要你開網銀才能收款", "請截圖帳戶頁面給賣貨便專員", "賣 貨 便 實 名 認 證"]) assert.ok(has(SHIP_VERIFY, t), t);
  for (const t of ["我用賣貨便寄東西很方便", "銀行要實名認證才能開戶", "明天去開網銀", "郵政客服電話幾號"]) assert.equal(has(SHIP_VERIFY, t), false, t);
});
test("10/27b 賣貨便：防詐提醒、這是詐騙嗎、白名單、雙模型 OK 都不算；模型判詐時加防詐字樣仍算", () => {
  for (const t of ["小心詐騙！賣貨便不會叫你實名認證", "有人說賣貨便要實名認證，這是詐騙嗎？"]) assert.equal(has(SHIP_VERIFY, t, unsure), false, t);
  const ad = "賣貨便實名認證，請加郵政客服";
  assert.equal(has(SHIP_VERIFY, ad, { ...scam, protectedSender: true }), false);
  assert.equal(has(SHIP_VERIFY, ad, { verdict: "OK", review: "OK" }), false);
  assert.ok(has(SHIP_VERIFY, `${ad} 小心詐騙`, scam));
});
test("10/27b 色情應召轉假平台：收費＋情色或加 TG／LINE；保證金不能單獨觸發", () => {
  for (const t of ["外約妹妹 先繳會員費 加line:abc123", "要見面請先買約會卡，加我賴", "解鎖照片只要遊戲點數 telegram 聯絡", "約砲要先付保證金", "應召 車馬費先付"]) assert.ok(has(SEX_PLATFORM, t), t);
  for (const t of ["請先繳保證金 加我line", "保證金退還流程", "會員費多少？", "遊戲點數哪裡買比較便宜", "派網要入金嗎 加好友教你", "加好友 一起入金"]) assert.equal(has(SEX_PLATFORM, t), false, t);
});
test("10/27b 色情假平台：防詐提醒引用字眼、白名單、雙模型 OK 不算", () => {
  assert.equal(has(SEX_PLATFORM, "提醒大家小心詐騙：外約要你繳認證金、解凍金都是假的", unsure), false);
  assert.equal(has(SEX_PLATFORM, "約砲要先付會員費嗎？這是詐騙嗎", unsure), false);
  assert.equal(has(SEX_PLATFORM, "外約先繳會員費 加line", { verdict: "OK", review: "OK" }), false);
  assert.equal(has(SEX_PLATFORM, "外約先繳會員費 加line", { ...scam, protectedSender: true }), false);
});
test("10/27b 一頁式精品網址：網域樣式＋名牌／出清都要有", () => {
  for (const t of ["LV 包三折出清 https://lux-outlet.shop/a", "名牌專櫃清倉 brandwholesale.top/x", "香奈兒特價 www.abc-express.store", "Gucci 出清 http://forumxyz.cam/p?1"]) assert.ok(has(LUXURY_URL, t), t);
  for (const t of ["好物推薦 https://lux-outlet.shop/a", "LV 包很好看 https://example.com", "名牌出清 https://outlet.example.com/a", "名牌出清 https://my-outlet.net", "LV 出清 https://shopee.tw/outlet", "全館出清 express.co"]) assert.equal(has(LUXURY_URL, t), false, t);
  assert.equal(has(LUXURY_URL, "小心詐騙！名牌出清 lux-outlet.shop 是假網站", unsure), false);
  assert.equal(has(LUXURY_URL, "名牌出清 lux-outlet.shop", { verdict: "OK", review: "OK" }), false);
  assert.equal(has(LUXURY_URL, "名牌出清 lux-outlet.shop", { ...scam, protectedSender: true }), false);
});
test("10/27b 三條都只通知：不進踢人分數、不在踢人群可踢理由，且有教學", () => {
  const msgs = { [SHIP_VERIFY]: "賣貨便實名認證 郵政客服", [SEX_PLATFORM]: "外約先繳會員費 加line", [LUXURY_URL]: "名牌出清 lux-outlet.shop" };
  for (const [n, t] of Object.entries(msgs)) {
    assert.equal(MINER_KICKABLE.has(n), false);
    assert.equal(ruleScore(t).names?.includes(n) ?? false, false);
    assert.equal(notifyScore(t, scam).notify, true);
    assert.equal(noticeTips([n]).length, 1);
  }
});
