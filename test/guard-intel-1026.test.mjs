import test from "node:test";
import assert from "node:assert/strict";
import { textNotifyReasons, makeNotifyTracker, notifyScore, LOAN_LURE, MINER_KICKABLE, intelNotify1026, INTEL_FAKE_GUARD, INTEL_SEND_GROUP_QR } from "../guard/notify-rules.mjs";
import { SHORTENERS } from "../guard/rules.mjs";

// 去識別化範例：網域、號碼、ID 都是假的。
const ctxScam = { verdict: "SCAM", review: "SCAM" };
const run = (text, extra = {}) => textNotifyReasons({ text, chatId: "c", senderId: "s", result: { verdict: "UNSURE", review: "UNSURE", names: [], score: 0 }, tracker: makeNotifyTracker(), shorteners: SHORTENERS, ...extra });

test("1026 情資：借貸新關鍵字＋引流 → 通知", () => {
  for (const t of ["免聯徵 保證過件 有需要加我LINE", "美化帳戶 協助過件 私訊我", "寄存摺跟提款卡就能撥款 賴:abc_123", "提款卡寄給我們 當天撥款 https://loan.example.test", "貸款核准後要設約定轉帳 加我好友詳談"]) {
    assert.ok(notifyScore(t, ctxScam).names.includes(LOAN_LURE), t);
  }
});

test("1026 情資：借貸新關鍵字但沒引流、聊自己、防詐提醒、問是不是詐騙 → 不通知", () => {
  for (const t of ["免聯徵保證過件這種廣告好多", "我設了約定轉帳繳房貸，很方便", "我上次被要求寄存摺，還好沒寄", "小心免聯徵貸款詐騙，不要私訊", "說保證過件叫我私訊，這是詐騙嗎？", "防詐提醒：美化帳戶叫你加LINE的都是假的"]) {
    assert.equal(notifyScore(t, ctxScam).names.includes(LOAN_LURE), false, t);
  }
  assert.equal(notifyScore("免聯徵保證過件 加我LINE", { ...ctxScam, protectedSender: true }).names.includes(LOAN_LURE), false);
});

test("1026 情資：模仿防詐警示樣式＋連結／QR／到新群驗證 → 通知", () => {
  for (const t of ["⚠️ 反詐提醒：本群已啟用防詐，請點 https://verify.example.test 完成驗證", "已移除可疑成員，剩下的人請掃 QR 重新驗證", "本群已啟用防詐系統，所有人請到新群驗證身分", "反詐提醒 line.me/ti/g2/abcdefg 請加入"]) {
    assert.deepEqual(intelNotify1026(t), [INTEL_FAKE_GUARD], t);
    assert.ok(run(t).includes(INTEL_FAKE_GUARD), t);
  }
});

test("1026 情資：警示樣式沒附連結、只有 YouTube、群友轉貼警告、白名單 → 不通知", () => {
  for (const t of ["⚠️ 反詐提醒：本群已啟用防詐，請大家注意", "已移除可疑成員，大家小心", "反詐提醒 教學影片 https://youtu.be/abc123", "防詐提醒：不要掃陌生人貼的 QR", "防詐提醒：https://bad.example.test 是詐騙"]) {
    assert.deepEqual(intelNotify1026(t), [], t);
  }
  assert.deepEqual(intelNotify1026("反詐提醒 請點 https://verify.example.test", { protectedSender: true }), []);
});

test("1026 情資：叫人回傳群組 QR → 通知；提醒與詢問不通知", () => {
  for (const t of ["幫我建個群，把群組QR回傳給我", "建好群後傳群組 QR 給我"]) assert.ok(intelNotify1026(t).includes(INTEL_SEND_GROUP_QR), t);
  for (const t of ["小心有人叫你回傳群組QR", "主管叫我回傳群組QR，這是詐騙嗎？", "群組QR在公告裡"]) assert.equal(intelNotify1026(t).includes(INTEL_SEND_GROUP_QR), false, t);
});

test("1026 情資：新規則只通知，不在 MINER_KICKABLE；純防詐機器人提醒仍跳過", () => {
  for (const n of [INTEL_FAKE_GUARD, INTEL_SEND_GROUP_QR, LOAN_LURE]) assert.equal(MINER_KICKABLE.has(n), false);
  assert.deepEqual(run("疑似詐騙提醒 訊息 ID：637690912345678901 詐騙機率：90% 此為模型估計，並非事實判定，請管理員查證。"), []);
  assert.deepEqual(run("派網今天有活動"), []);
});
