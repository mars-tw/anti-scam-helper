import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  notifyScore, textNotifyReasons, makeNotifyTracker, directNotifyNames,
  LOAN_LURE, noticeTips, MINER_KICKABLE, minerAction,
} from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

const scam = { verdict: "SCAM", review: "SCAM" };
const ok = { verdict: "OK", review: "OK" };
const ruleScore = makeRuleScorer([]);
const hasLoan = (t, ctx = scam) => notifyScore(t, ctx).names.includes(LOAN_LURE);

// 去識別化正例（repo 禁真實手機／人名；品牌用佔位）
const LOAN_AD = "1-10萬線上申請，30萬分60期，免碰面，名額有限，有工作即可，0912-345-678 王先生 手機可加好友";
const LOAN_AD_B = "小額貸款 50萬分36期 線上借款 加我好友 0912345678";

// 士軒 10/29 18:23「合理正確廣告」反例：品牌＋品項價＋檔期＋bsms.tw 短鏈（非群邀請）→ 必須 0 分
const LEGIT_AD = "【品牌A、10/16-25大披薩或6入蛋塔外帶價199元，6塊炸雞外帶價209元！加價可升級新口味披薩，線上預購bsms.tw/9EnRUv】";

test("1029 貸款廣告正例：額度／分期＋聯絡 → 只通知（不進踢人）", () => {
  for (const t of [LOAN_AD, LOAN_AD_B, "3萬線上申請 免碰面 私訊我", "分期貸款當日撥款 賴:abc-123"]) {
    assert.ok(hasLoan(t), t);
    assert.equal(notifyScore(t, scam).notify, true);
    assert.ok(notifyScore(t, scam).score >= 4);
  }
  assert.deepEqual(directNotifyNames(LOAN_AD, scam), [LOAN_LURE]);
  assert.equal(MINER_KICKABLE.has(LOAN_LURE), false);
  assert.equal(ruleScore({}, LOAN_AD).names.includes(LOAN_LURE), false);
  assert.equal(ruleScore({}, LOAN_AD).score, 0);
});

test("1029 反例：只加好友、房貸討論、派網入金、合理披薩廣告 → 0 分", () => {
  for (const t of [
    "加我好友聊聊",
    "手機可加好友",
    "央行升息後房貸利率怎麼選？大家討論一下",
    "我在看銀行房貸方案，有人推哪家嗎",
    "派網入金教學看這裡，先小額試試",
    LEGIT_AD,
  ]) {
    assert.equal(hasLoan(t), false, t);
    assert.equal(notifyScore(t, scam).notify, false, t);
    assert.equal(notifyScore(t, scam).score, 0, t);
  }
  // 合理廣告也不進踢人分數
  assert.equal(ruleScore({}, LEGIT_AD).score, 0);
  assert.deepEqual(ruleScore({}, LEGIT_AD).names, []);
});

test("1029：合理廣告與貸款樣本明確分開（通知名稱／分數）", () => {
  const ad = notifyScore(LEGIT_AD, scam);
  const loan = notifyScore(LOAN_AD, scam);
  assert.equal(ad.notify, false);
  assert.equal(ad.score, 0);
  assert.ok(!ad.names.includes(LOAN_LURE));
  assert.equal(loan.notify, true);
  assert.ok(loan.names.includes(LOAN_LURE));
  assert.notEqual(ad.score, loan.score);
});

test("1029 對抗：全形數字、字間空格仍命中貸款廣告", () => {
  assert.ok(hasLoan("１－１０萬線上申請　０９１２－３４５－６７８　可加好友"));
  assert.ok(hasLoan("1 - 10 萬 線 上 申 請，0 9 1 2 - 3 4 5 - 6 7 8 可 加 好 友"));
  assert.ok(hasLoan("３０萬分６０期 加我好友 0912345678"));
});

test("1029 對抗：同格式廣告＋群邀請或＋貸款話術 → 不可放行", () => {
  const withInvite = LEGIT_AD + " https://line.me/ti/g2/ABCDEFGxyzInvite";
  const kick = ruleScore({}, withInvite);
  assert.ok(kick.score >= 5, JSON.stringify(kick));
  assert.ok(
    kick.names.some((n) => /邀請|群組/.test(n)),
    JSON.stringify(kick.names),
  );

  const withLoan = LEGIT_AD + " 另有1-10萬線上申請 0912-345-678 可加好友";
  assert.ok(hasLoan(withLoan), "披薩格式夾貸款話術仍須通知");
  assert.equal(notifyScore(withLoan, scam).notify, true);
});

test("1029：三種群（踢人／非踢人／Hao0321 警告）皆只通知、不踢", () => {
  const reasons = [LOAN_LURE];
  // 踢人群（perChatKick=true）：仍 notice，因 LOAN_LURE 不在 MINER_KICKABLE
  assert.equal(minerAction({ perChatKick: true, reasons, verdict: "SCAM", model: "claude", review: "SCAM" }), "notice");
  // 非踢人群
  assert.equal(minerAction({ perChatKick: false, reasons, verdict: "SCAM", model: "claude", review: "SCAM" }), "notice");
  // Hao0321 類 warnOnly：規則層同樣不進踢人集合（上層只警告）
  assert.equal(MINER_KICKABLE.has(LOAN_LURE), false);
  assert.equal(ruleScore({}, LOAN_AD).score, 0);
});

test("1029：雙模型 OK／白名單不算；教學文案提到貸款廣告；rules.mjs 無貸款廣告字眼", () => {
  assert.equal(hasLoan(LOAN_AD, ok), false);
  assert.equal(hasLoan(LOAN_AD, { ...scam, protectedSender: true }), false);
  const tips = noticeTips([LOAN_LURE]);
  assert.equal(tips.length, 1);
  assert.match(tips[0], /小額|分期|貸款/);
  const src = readFileSync(new URL("../guard/rules.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("貸款廣告"), false);
  assert.equal(src.includes("1-10萬"), false);
  assert.ok(textNotifyReasons({
    text: LOAN_AD, chatId: "c", senderId: "s",
    result: { verdict: "SCAM", review: "SCAM", names: [], score: 0 },
    tracker: makeNotifyTracker(), shorteners: SHORTENERS,
  }).includes(LOAN_LURE));
});
