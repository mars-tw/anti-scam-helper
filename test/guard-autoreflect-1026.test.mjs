import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAntiScamBotAlert, isPlainAntiScamBotAlert, alertHasLinkSignal } from "../guard/policy.mjs";
import { textNotifyReasons, makeNotifyTracker, notifyScore, directNotifyNames, LOAN_LURE, noticeTips, MINER_KICKABLE } from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

// 去識別化的範例（成員 ID、暱稱、號碼都是假的）。
const IMPERSONATION_ALERT = "疑似冒充管理員提醒\n新成員：測試名稱\n成員 ID：u0123456789abcdef0123456789abcdef\n假冒機率：未能判定\n名稱含管理員相關字詞：是\n此為自動判定，並非事實認定，請管理員查證。\n@成員甲 @成員乙 @測試帳號";
const RISK_ALERT = "⚠️ 疑似詐騙提醒\n這是風險提醒，尚未認定發言者有不法行為；請管理員協助核對。\n疑似類別：投資詐騙\n@成員甲";

test("1026：冒充管理員提醒、風險提醒格式都認得是防詐機器人提醒（不回覆）", () => {
  assert.equal(isAntiScamBotAlert(IMPERSONATION_ALERT), true);
  assert.equal(isAntiScamBotAlert(RISK_ALERT), true);
  assert.equal(isPlainAntiScamBotAlert(IMPERSONATION_ALERT), true);
  assert.equal(isPlainAntiScamBotAlert(RISK_ALERT), true);
});

test("1026：只有標題或只有一個欄位的一般訊息不算提醒", () => {
  assert.equal(isAntiScamBotAlert("疑似冒充管理員提醒：大家小心喔"), false);
  assert.equal(isAntiScamBotAlert("疑似冒充管理員提醒 請管理員查證一下"), false);
  assert.equal(isAntiScamBotAlert("成員 ID：abc 請管理員查證"), false); // 沒標題
  assert.equal(isAntiScamBotAlert("今天天氣很好，這不是疑似詐騙提醒"), false);
});

test("1026 對抗：假提醒格式夾電話／拆字 LINE／私訊／其他通訊軟體／連結，照一般流程（不跳過）", () => {
  for (const extra of [" 借錢找 0912-345-678", " 0912345678", " +886 912 345 678", " 賴:123-456-78（去掉-）", " 有需要私訊我", " 加我", " telegram：@abc", " 微信 abc123", " https://example.test/x", " bit.ly/Ab12cd", " line.me/ti/g2/abcdef"]) {
    for (const base of [IMPERSONATION_ALERT, RISK_ALERT]) {
      assert.equal(alertHasLinkSignal(base + extra), true, extra);
      assert.equal(isPlainAntiScamBotAlert(base + extra), false, extra);
    }
  }
  // 18 位數訊息 ID 不會被當成電話
  assert.equal(alertHasLinkSignal("疑似詐騙提醒 訊息 ID：637690912345678901 詐騙機率：90% 並非事實判定"), false);
});

test("1026 對抗：假冒提醒＋代償借貸＋拆字 LINE 仍會通知", () => {
  const fake = IMPERSONATION_ALERT + "\n代償高利小額、整合週轉，留個訊息 賴:123-456-78（去掉-）";
  const out = textNotifyReasons({ text: fake, chatId: "c", senderId: "s", result: { verdict: "SCAM", review: "SCAM", names: [] }, tracker: makeNotifyTracker(), shorteners: SHORTENERS });
  assert.ok(out.includes(LOAN_LURE), JSON.stringify(out));
});

const LOAN = "代償高利小額 整合週轉 有需要的朋友留個訊息就好 賴:123-456-78（去掉-）";
const ctxScam = { verdict: "SCAM", review: "SCAM" };

test("1026：代償／整合借貸＋私下聯絡 → 直接通知（只通知）", () => {
  assert.ok(notifyScore(LOAN, ctxScam).notify);
  assert.ok(notifyScore(LOAN, ctxScam).names.includes(LOAN_LURE));
  assert.ok(notifyScore(LOAN, { verdict: "SCAM" }).notify);
  assert.ok(notifyScore("債務整合、卡債代償，免審核快速撥款，加我LINE詳談", ctxScam).notify);
  assert.ok(notifyScore("小額借款 當日撥款 電話 0912-345-678", { verdict: "UNSURE" }).notify);
  assert.deepEqual(directNotifyNames(LOAN, ctxScam), [LOAN_LURE]);
  assert.ok(noticeTips([LOAN_LURE]).length === 1);
  assert.equal(MINER_KICKABLE.has(LOAN_LURE), false);
});

test("1026：一般借貸討論、防詐提醒、問是不是詐騙、兩個模型都 OK、白名單、派網沒連結 → 不通知", () => {
  for (const t of ["銀行的債務整合方案利率大概多少？", "我之前辦過信貸代償，利息有比較低", "小心代償詐騙，不要私訊陌生人", "這種整合負債留言私訊是詐騙嗎？", "提醒大家：說能幫你代償、叫你私訊的都是假的"]) {
    assert.equal(notifyScore(t, ctxScam).names.includes(LOAN_LURE), false, t);
  }
  assert.equal(notifyScore(LOAN, { verdict: "OK", review: "OK" }).names.includes(LOAN_LURE), false);
  assert.equal(notifyScore(LOAN, { ...ctxScam, protectedSender: true }).names.includes(LOAN_LURE), false);
  assert.equal(notifyScore("派網上有人說代償小額，私訊問問", ctxScam).names.includes(LOAN_LURE), false);
});

test("1026 對抗：代償借貸夾防詐字眼但寫出具體聯絡方式，仍通知", () => {
  for (const t of ["小心詐騙！正派代償整合 賴:abc123", "注意詐騙 小額借款找我 0912345678", "不要亂加別人，代償請找我們 line.me/ti/p/abcdef"]) {
    assert.ok(notifyScore(t, ctxScam).names.includes(LOAN_LURE), t);
  }
});

test("1026：新規則不進踢人計分（rules.mjs 分數不變）", () => {
  const scorer = makeRuleScorer([]);
  const before = scorer({ senderId: "s", channelId: "c" }, "整合週轉 留個訊息就好");
  assert.equal(before.names.includes(LOAN_LURE), false);
  const src = readFileSync(new URL("../guard/rules.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("代償"), false);
});

test("1026：只學習＋判斷通知群跳過純提醒、套用直接通知規則（派網沒連結不算）", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(isPlainAntiScamBotAlert\(text\) && !hasLineInfo\(text\)\) \{ record\(\{ action: "bot-alert-skipped", scanNotify: true/);
  assert.match(src, /!exchangeTextNoLink\(text\)\) \{\n    const direct = directNotifyNames\(text/);
  assert.deepEqual(directNotifyNames("福利群每日簽到 合資", ctxScam), []); // 累積分數類不在只學習群單獨觸發
  assert.deepEqual(directNotifyNames(IMPERSONATION_ALERT, ctxScam), []);
});
