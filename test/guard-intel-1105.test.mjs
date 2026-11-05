import test from "node:test";
import assert from "node:assert/strict";
import { textNotifyReasons, makeNotifyTracker, notifyScore, noticeTips, minerAction, MINER_KICKABLE, STOCK_LIST_OA, FAKE_LOGISTICS_URL, FAKE_LOGISTICS_VERIFY } from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { kickScopeDecision } from "../guard/kick-scope.mjs";

// 只用虛構群組 ID／網域，不放真實資料。
const ruleScore = makeRuleScorer();
const KICK = "cKickTest", PLAIN = "cPlainTest", WARN = "cWarnOnlyTest", BEAR = "cExcludedTest", LEARN = "cLearnTest";
const scope = { excludeChats: [BEAR], learnOnly: new Set([LEARN]), warnOnly: new Set([WARN]) };
const unsure = { verdict: "UNSURE", review: "SCAM", score: 0, names: [] };
const reasons = (text, result = unsure) => textNotifyReasons({ text, chatId: PLAIN, senderId: "u1", result: { ...result, ...ruleScore({}, text) , verdict: result.verdict, review: result.review }, tracker: makeNotifyTracker(), shorteners: SHORTENERS });
const sub = (t) => ruleScore({}, t).names.includes("子網域短網址");

function onlyNotify(text, name, { zeroRule = false } = {}) {
  const r = ruleScore({}, text);
  assert.equal(MINER_KICKABLE.has(name), false);
  if (!zeroRule) assert.equal(r.names.includes(name), false, "通知理由不進踢人計分");
  for (const chatId of [KICK, PLAIN, WARN, BEAR, LEARN]) {
    const d = kickScopeDecision({ chatId, scope, text, names: [...r.names, name], verdict: "SCAM", review: "SCAM" });
    assert.equal(d.kick, false, `${chatId} 不踢`);
    assert.equal(minerAction({ perChatKick: chatId === KICK, reasons: [name], verdict: "SCAM", model: "claude-x", review: "SCAM" }), "notice");
  }
  assert.equal(kickScopeDecision({ chatId: WARN, scope, text, names: [name] }).reason, "warn-only");
  assert.equal(kickScopeDecision({ chatId: BEAR, scope, text, names: [name] }).reason, "kick-scope-excluded");
  assert.equal(kickScopeDecision({ chatId: LEARN, scope, text, names: [name] }).reason, "learn-only");
}

test("11/5-1 子網域短網址：rules 認得、分數 0；一般網域子字串不中", () => {
  for (const t of ["群組搬家請點 go.reurl.cc/Ab12", "https://ab.supr.link/x1", "a.b.bit.ly/Zz9"]) assert.ok(sub(t), t);
  for (const t of ["reurl.cc/Ab12", "mybit.ly/abc", "evil-reurl.cc/x", "x.reurl.cc.example.com/a", "news.id/abc", "看 https://bit.ly.example.org/q"]) assert.equal(sub(t), false, t);
  assert.equal(ruleScore({}, "go.reurl.cc/Ab12").score, ruleScore({}, "go.example.cc/Ab12").score >= 0 ? ruleScore({}, "go.reurl.cc/Ab12").score : 0);
  const a = ruleScore({}, "看 go.reurl.cc/Ab12"); const b = ruleScore({}, "看 go.reurlx.cc/Ab12");
  assert.equal(a.score, b.score, "子網域短網址不加踢人分");
});
test("11/5-1 子網域短網址：通知正反例（含防詐提醒對抗）", () => {
  assert.ok(reasons("群組搬家請點 go.reurl.cc/Ab12").includes("子網域短網址"));
  assert.equal(reasons("這是不是詐騙？go.reurl.cc/Ab12 別點").includes("子網域短網址"), false);
  assert.equal(reasons("這是不是詐騙？go.reurl.cc/Ab12 別點", { verdict: "OK", review: "OK" }).includes("子網域短網址"), false);
  assert.ok(reasons("小心詐騙！群組搬家 go.reurl.cc/Ab12", { verdict: "SCAM", review: "SCAM" }).includes("子網域短網址"), "詐騙者加提醒字樣仍通知");
  assert.equal(reasons("https://reurl.cc/Ab12 好文").includes("子網域短網址"), false);
  onlyNotify("群組搬家請點 go.reurl.cc/Ab12", "子網域短網址", { zeroRule: true }); // rules 裡同名規則分數 0
});

const OA = "line.me/R/ti/p/@ab12xy";
test("11/5-2 潛力股＋LINE@：正例只通知，踢人計分不變", () => {
  for (const t of [`免費領明天潛力股名單 加 ${OA}`, `飆股名單每天更新 https://${OA}`, `台股快5萬點還不跟上？領完整名單 ${OA}`, `潛 力 股 名 單 ${OA}`]) {
    assert.ok(notifyScore(t, { verdict: "UNSURE" }).names.includes(STOCK_LIST_OA), t);
  }
  const t = `免費領明天潛力股名單 加 ${OA}`;
  // 踢人計分與 8af6d17 完全相同（8af6d17 實測此句 3 分；LINE 官方帳號連結照樣 -1）。
  assert.equal(ruleScore({}, t).score, 3, "與 8af6d17 同分");
  assert.equal(ruleScore({}, t).score, ruleScore({}, `加 ${OA}`).score, "潛力股字眼不改踢人分");
  assert.ok(ruleScore({}, t).names.includes("LINE 官方帳號連結"));
  assert.ok(noticeTips([STOCK_LIST_OA]).length === 1);
  onlyNotify(t, STOCK_LIST_OA);
});
test("11/5-2 潛力股＋LINE@：反例（一般聊股、交易所官方、商家促銷、防詐提醒、白名單、雙 OK）", () => {
  const no = (t, ctx = { verdict: "UNSURE" }) => assert.equal(notifyScore(t, ctx).names.includes(STOCK_LIST_OA), false, t);
  no("今天大盤漲了，我加碼台積電");
  no("這檔是潛力股，大家怎麼看");
  no(`這檔是潛力股 https://news.example.org/a`);
  for (const id of ["binance", "bybit", "OKX", "pionex"]) no(`本週潛力股幣種整理，追蹤官方帳號 line.me/R/ti/p/@${id}`);
  no(`限時優惠！加入官方帳號領完整名單與折價券 ${OA}`);
  no(`週年慶全館五折，加好友領優惠 ${OA}`);
  no(`提醒大家：說送潛力股名單叫你加 ${OA} 的是詐騙，不要加`);
  no(`免費領明天潛力股名單 加 ${OA}`, { verdict: "OK", review: "OK" });
  no(`免費領明天潛力股名單 加 ${OA}`, { verdict: "SCAM", protectedSender: true });
  assert.ok(notifyScore(`小心詐騙！免費領潛力股名單 ${OA}`, { verdict: "SCAM" }).names.includes(STOCK_LIST_OA), "對抗：詐騙者加提醒字樣");
  assert.ok(notifyScore(`潛力股名單 line.me/R/ti/p/@binance_vip`, { verdict: "UNSURE" }).names.includes(STOCK_LIST_OA), "仿交易所 ID 不算官方");
});

const FAKE = "https://t-cat.abc1.tw.xyz9.shop/x";
test("11/5-3 仿物流多層子網域：正例只通知，實名認證／解凍加分", () => {
  for (const t of [`包裹異常請點 ${FAKE}`, "7-11 取貨失敗 myship.q1.tw.zz2.top/a", "ibon.xx.yy.cam/t 補件"]) assert.ok(notifyScore(t, { verdict: "UNSURE" }).names.includes(FAKE_LOGISTICS_URL), t);
  const base = notifyScore(`包裹異常請點 ${FAKE}`, { verdict: "UNSURE" });
  const more = notifyScore(`包裹異常請填 ${FAKE} 完成實名認證`, { verdict: "UNSURE" });
  assert.ok(more.names.includes(FAKE_LOGISTICS_VERIFY));
  assert.ok(notifyScore(`帳戶已凍結，至 ${FAKE} 解凍`, { verdict: "UNSURE" }).names.includes(FAKE_LOGISTICS_VERIFY));
  assert.equal(more.score, base.score + 2);
  assert.equal(base.names.includes(FAKE_LOGISTICS_VERIFY), false);
  onlyNotify(`包裹異常請填 ${FAKE} 完成實名認證`, FAKE_LOGISTICS_URL);
  onlyNotify(`包裹異常請填 ${FAKE} 完成實名認證`, FAKE_LOGISTICS_VERIFY);
});
test("11/5-3 仿物流：反例（官方網址尾端比對、一般網域、只有兩層、防詐提醒、雙 OK）", () => {
  const no = (t, ctx = { verdict: "UNSURE" }) => { const n = notifyScore(t, ctx).names; assert.equal(n.includes(FAKE_LOGISTICS_URL) || n.includes(FAKE_LOGISTICS_VERIFY), false, t); };
  no("我的包裹到哪了 https://www.t-cat.com.tw/inquire/trace.aspx");
  no("賣貨便查件 https://myship.7-11.com.tw/order 要實名認證嗎");
  no("ibon 列印 https://www.ibon.com.tw/a");
  no("https://famiport.family.com.tw/x");
  no("郵局 https://postserv.post.gov.tw/pstmail/main");
  no("https://t-cat-fans.shop/x"); // 只有兩層，不算多層子網域
  no("https://cat.example.com/a 好可愛");
  no("https://hctx.example.com.tw/a");
  no(`提醒大家，${FAKE} 這種假黑貓連結不要點`);
  no(`包裹異常請點 ${FAKE}`, { verdict: "OK", review: "OK" });
  no(`包裹異常請點 ${FAKE}`, { verdict: "SCAM", protectedSender: true });
  assert.ok(notifyScore(`防詐提醒：包裹異常請點 ${FAKE}`, { verdict: "SCAM" }).names.includes(FAKE_LOGISTICS_URL), "對抗");
  // 仿冒官方尾端：t-cat.com.tw.evil 不是官方
  assert.ok(notifyScore("https://t-cat.com.tw.q1.shop/a", { verdict: "UNSURE" }).names.includes(FAKE_LOGISTICS_URL));
});
