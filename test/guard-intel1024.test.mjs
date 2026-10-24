import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyScore, noticeTips, textNotifyReasons, makeNotifyTracker, MINER_KICKABLE, WORK_MONEY, FAKE_VERIFY, WITHDRAW_FEE, CODE_COUPON } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
import { exchangeTextNoLink } from "../guard/exchange-nolink.mjs";

const has = (t, name, ctx) => notifyScore(t, ctx).names.includes(name);
const rs = makeRuleScorer();
const reasons = (text, extra = {}) => textNotifyReasons({ text, chatId: "c1", senderId: "u1", result: { verdict: "OK", score: 0, names: [] }, tracker: makeNotifyTracker(), ...extra });

test("新規則都不在踢人群可踢清單", () => {
  for (const n of [WORK_MONEY, FAKE_VERIFY, WITHDRAW_FEE, CODE_COUPON]) assert.equal(MINER_KICKABLE.has(n), false);
});
test("新規則不改踢人分數", () => {
  for (const t of ["幫我查一下帳戶餘額，今天先匯到指定帳戶", "金流認證失敗請加我 LINE 處理"]) {
    assert.equal(rs({}, t).score, rs({}, t).score);
  }
});
test("1) 工作指示要匯款：正例", () => {
  assert.ok(has("小陳，老闆交代今天先把款項匯到指定帳戶，馬上處理", WORK_MONEY));
  assert.ok(has("幫我看一下公司帳戶餘額多少，回我", WORK_MONEY));
  assert.ok(noticeTips([WORK_MONEY]).some((x) => x.includes("打電話")));
  assert.ok(reasons("老闆交代今天先轉到指定帳戶").includes(WORK_MONEY));
});
test("1) 工作指示要匯款：反例", () => {
  assert.equal(has("我剛查了帳戶餘額，還夠", WORK_MONEY), false, "沒有指示語氣");
  assert.equal(has("小心詐騙！有人冒充老闆叫你馬上匯到指定帳戶", WORK_MONEY), false, "防詐提醒語氣");
  assert.equal(has("老闆交代今天先匯到指定帳戶", WORK_MONEY, { protectedSender: true }), false, "管理員／白名單");
  assert.equal(reasons("老闆交代今天先匯到指定帳戶", { protectedSender: true }).includes(WORK_MONEY), false);
});
test("2) 假認證＋加 LINE：正例", () => {
  assert.ok(has("您的賣場金流認證未完成，請加我 LINE 協助", FAKE_VERIFY));
  assert.ok(has("帳戶驗證失敗，請私訊客服", FAKE_VERIFY));
  assert.ok(has("需要實名制認證，加好友處理", FAKE_VERIFY));
  assert.ok(has("免費餐券送完為止，加入群組領取", FAKE_VERIFY));
  assert.ok(has("合資訂單名額有限，加 LINE 報名", FAKE_VERIFY));
});
test("2) 假認證＋加 LINE：反例", () => {
  assert.equal(has("銀行 App 要做實名認證，記得去臨櫃", FAKE_VERIFY), false);
  assert.equal(has("公司發了免費餐券，好開心", FAKE_VERIFY), false);
  assert.equal(has("這筆合資訂單上週已經結案", FAKE_VERIFY), false);
  assert.equal(has("提醒：小心詐騙，說金流認證要加 LINE 的都是假的", FAKE_VERIFY), false);
  assert.equal(has("金流認證失敗請加我 LINE", FAKE_VERIFY, { protectedSender: true }), false);
});
test("3) 出金要先繳費＋聯絡方式", () => {
  assert.ok(has("要出金必須先繳保證金，請私訊客服 https://example.invalid/pay", WITHDRAW_FEE));
  assert.ok(has("出金前要補繳稅金，加我 LINE 辦理", WITHDRAW_FEE));
  assert.ok(has("帳戶凍結無法出金，繳解凍費後掃 QR 處理", WITHDRAW_FEE));
  assert.equal(has("出金要先繳保證金嗎？我不清楚", WITHDRAW_FEE), false, "沒聯絡方式");
  assert.equal(has("今天出金很順", WITHDRAW_FEE), false);
  assert.equal(has("注意詐騙：出金要先繳稅金還叫你加 LINE 的都是假的", WITHDRAW_FEE), false);
  assert.ok(exchangeTextNoLink("出金要先繳保證金嗎"), "派網沒連結仍走原本的只記錄邏輯");
});
test("4) 領券要回傳驗證碼", () => {
  assert.ok(has("領券活動，收到簡訊請回傳驗證碼", CODE_COUPON));
  assert.ok(has("送你折價券，把驗證碼傳給我就好", CODE_COUPON));
  assert.equal(has("驗證碼不要給別人", CODE_COUPON), false);
  assert.equal(has("今天領券買菜省很多", CODE_COUPON), false);
  assert.equal(has("幫我投票送好禮，輸入驗證碼後回傳驗證碼", CODE_COUPON), false, "假投票規則已命中");
  assert.ok(has("幫我投票送好禮，輸入驗證碼後回傳驗證碼", "假投票／活動騙認證碼"));
});
test("一般 YouTube 連結不觸發新規則", () => {
  const n = notifyScore("分享影片 https://www.youtube.com/watch?v=abc123 很好看");
  for (const x of [WORK_MONEY, FAKE_VERIFY, WITHDRAW_FEE, CODE_COUPON]) assert.equal(n.names.includes(x), false);
});
