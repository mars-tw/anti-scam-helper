// 10/30 提案 A／B／D：只通知（不刪不踢、不計入踢人分數）。
// A) 暗稱（尾端空白等）looksLike 群管 ＋短網址／記事本
// B) 暱稱以 @／＠ 開頭且 looksLike 群管（訊息內「@群管」提問不算）
// D) 同則群組邀請＋加好友
// 三種群：踢人／非踢人／Hao0321 只警告；對抗：真群管本人、一般成員「@群管」提問；踢人分數不變。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  darkNickNotifyReasons, intelNotify1030, textNotifyReasons, makeNotifyTracker,
  noticeTips, MINER_KICKABLE, minerAction, normalizeNickKey,
  INTEL_DARK_NICK_SHORT, INTEL_AT_ADMIN_NICK, INTEL_INVITE_AND_FRIEND,
} from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { kickScopeDecision } from "../guard/kick-scope.mjs";

const ADMIN = "群主小明";
const ADMINS = [ADMIN, "管理員阿花"];
const SHORT = "請點 https://reurl.cc/AbCdEf 查看活動";
const NOTE = "請看記事本 https://bit.ly/x9k2m";
const INVITE_FRIEND = "本群要搬家，新群 https://line.me/ti/g2/AbCdEfGhIjK 也請加我好友 line.me/ti/p/XxYyZzFake";
const INVITE_ONLY = "請加入新群 https://line.me/ti/g2/AbCdEfGhIjK";
const FRIEND_ONLY = "有問題加我好友 line.me/ti/p/XxYyZzFake";
const ruleScore = makeRuleScorer([]);

const scopeThree = {
  excludeChats: ["cBear"],
  learnOnly: new Set(["cLearn"]),
  warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]), // Hao0321 類只警告
};

const nick = (senderName, text, extra = {}) =>
  darkNickNotifyReasons({ senderName, adminNames: ADMINS, text, shorteners: SHORTENERS, ...extra });

const tnr = (text, extra = {}) =>
  textNotifyReasons({
    text, chatId: "c", senderId: "s",
    result: { verdict: "UNSURE", review: "UNSURE", names: [], score: 0 },
    tracker: makeNotifyTracker(), shorteners: SHORTENERS, ...extra,
  });

test("1030 A：暗稱（尾端空白／NBSP）＋短網址／記事本 → 只通知", () => {
  for (const name of [`${ADMIN} `, `${ADMIN}\u00A0`, `${ADMIN}\u2003`]) {
    assert.ok(nick(name, SHORT).includes(INTEL_DARK_NICK_SHORT), name);
    assert.ok(nick(name, NOTE).includes(INTEL_DARK_NICK_SHORT), name + " note");
  }
  assert.deepEqual(nick("路人甲乙丙", SHORT), []);
  assert.deepEqual(nick(`${ADMIN} `, "今天天氣不錯"), []);
});

test("1030 B：暱稱 @／＠ 群管 → 只通知；訊息內 @群管 提問不算", () => {
  assert.ok(nick(`@${ADMIN}`, "大家好").includes(INTEL_AT_ADMIN_NICK));
  assert.ok(nick(`＠${ADMIN}`, "公告看這裡").includes(INTEL_AT_ADMIN_NICK));
  // 一般成員暱稱正常，訊息寫「@群管 這是真的嗎」→ 不觸發 B
  assert.deepEqual(nick("一般成員小陳", `@${ADMIN} 這是真的嗎？`), []);
  assert.deepEqual(nick("路人甲", "@群管 請問活動怎麼參加"), []);
});

test("1030 A+B：＠暗稱＋短網址可同時命中兩條", () => {
  const r = nick(`@${ADMIN}`, SHORT);
  assert.ok(r.includes(INTEL_DARK_NICK_SHORT));
  assert.ok(r.includes(INTEL_AT_ADMIN_NICK));
});

test("1030 D：同則邀請＋加好友 → 通知；單邊不加", () => {
  assert.deepEqual(intelNotify1030(INVITE_FRIEND), [INTEL_INVITE_AND_FRIEND]);
  assert.ok(tnr(INVITE_FRIEND).includes(INTEL_INVITE_AND_FRIEND));
  assert.deepEqual(intelNotify1030(INVITE_ONLY), []);
  assert.deepEqual(intelNotify1030(FRIEND_ONLY), []);
  assert.equal(tnr(INVITE_ONLY).includes(INTEL_INVITE_AND_FRIEND), false);
});

test("1030 對抗：真群管本人（protectedSender）→ A／B／D 都不通知", () => {
  assert.deepEqual(nick(`@${ADMIN}`, SHORT, { protectedSender: true }), []);
  assert.deepEqual(nick(`${ADMIN} `, SHORT, { protectedSender: true }), []);
  assert.deepEqual(intelNotify1030(INVITE_FRIEND, { protectedSender: true }), []);
  assert.equal(tnr(INVITE_FRIEND, { protectedSender: true }).includes(INTEL_INVITE_AND_FRIEND), false);
});

test("1030 對抗：討論短網址風險／詢問語氣 → 不誤報 A", () => {
  const ask = "有人傳 https://reurl.cc/AbCdEf 說是活動，這是詐騙嗎？";
  assert.equal(nick(`${ADMIN} `, ask).includes(INTEL_DARK_NICK_SHORT), false);
  const warn = "小心短網址 https://reurl.cc/AbCdEf 別點，可能是詐騙";
  assert.equal(nick(`${ADMIN} `, warn).includes(INTEL_DARK_NICK_SHORT), false);
});

test("1030：三種群（踢人／非踢人／Hao0321 只警告）皆只通知、不踢", () => {
  const reasons = [INTEL_DARK_NICK_SHORT, INTEL_AT_ADMIN_NICK, INTEL_INVITE_AND_FRIEND];
  for (const r of reasons) {
    assert.equal(MINER_KICKABLE.has(r), false, r);
    assert.equal(minerAction({ perChatKick: true, reasons: [r], verdict: "SCAM", model: "claude", review: "SCAM" }), "notice", r);
    assert.equal(minerAction({ perChatKick: false, reasons: [r], verdict: "SCAM", model: "claude", review: "SCAM" }), "notice", r);
  }
  // Hao0321 類 warnOnly：即使內容含群邀請，kickScope 也不踢
  assert.equal(kickScopeDecision({ chatId: "cWarn1", scope: scopeThree, text: INVITE_FRIEND }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cWarn2", scope: scopeThree, text: SHORT }).kick, false);
  // 踢人群對「純 A／B 原因」不因本提案升級（本提案不進 kickCategory）
  assert.equal(kickScopeDecision({ chatId: "cMain", scope: scopeThree, text: SHORT }).kick, false);
});

test("1030：踢人分數不變（新規則名不在 rules.mjs；A／B 樣本不加踢分）", () => {
  const src = readFileSync(new URL("../guard/rules.mjs", import.meta.url), "utf8");
  for (const n of [INTEL_DARK_NICK_SHORT, INTEL_AT_ADMIN_NICK, INTEL_INVITE_AND_FRIEND]) {
    assert.equal(src.includes(n), false, n);
  }
  // A／B 樣本：規則踢分不得因本提案增加（短網址本身通常 0 或既有規則）
  const aScore = ruleScore({}, SHORT);
  assert.equal(aScore.names.includes(INTEL_DARK_NICK_SHORT), false);
  assert.equal(aScore.names.includes(INTEL_AT_ADMIN_NICK), false);
  // D 樣本：既有邀請規則可能計分，但不得出現本提案名稱；分數與「只有邀請」一致方向（本提案不加權）
  const dOnlyInvite = ruleScore({}, INVITE_ONLY);
  const dBoth = ruleScore({}, INVITE_FRIEND);
  assert.equal(dBoth.names.includes(INTEL_INVITE_AND_FRIEND), false);
  // 本提案不把 D 寫進 rules，故 dBoth 分數不會因 INTEL_INVITE_AND_FRIEND 變高
  assert.ok(!dBoth.names.includes(INTEL_INVITE_AND_FRIEND));
  // 記錄基線：兩邊都可有邀請相關規則，但 D 名稱不在踢分名單
  assert.ok(typeof dOnlyInvite.score === "number");
  assert.ok(typeof dBoth.score === "number");
});

test("1030：normalizeNickKey 與暗稱對得上；noticeTips 有三條", () => {
  assert.equal(normalizeNickKey(`${ADMIN} `), normalizeNickKey(ADMIN));
  assert.equal(normalizeNickKey(`@${ADMIN}`), normalizeNickKey(ADMIN));
  assert.equal(normalizeNickKey(`＠${ADMIN}`), normalizeNickKey(ADMIN));
  const tips = noticeTips([INTEL_DARK_NICK_SHORT, INTEL_AT_ADMIN_NICK, INTEL_INVITE_AND_FRIEND]);
  assert.equal(tips.length, 3);
});

test("1030：既有暱稱比對／Hao0321 警告規定未改動（kickScope warnOnly 仍不踢）", () => {
  const fakeGroup = "本群明天刪除，請加入新二群 https://line.me/ti/g2/AbCdEfGhIjK";
  assert.equal(kickScopeDecision({ chatId: "cWarn1", scope: scopeThree, text: fakeGroup }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cMain", scope: scopeThree, text: fakeGroup }).kick, true);
});

test("1030 A：群主暱稱尾端 U+2800＋短網址／記事本 → 冒名通知理由", () => {
  const braille = `${ADMIN}\u2800`;
  assert.equal(normalizeNickKey(braille), normalizeNickKey(ADMIN));
  const r = nick(braille, SHORT);
  assert.ok(r.includes(INTEL_DARK_NICK_SHORT), "U+2800 dark nick");
  assert.ok(nick(braille, NOTE).includes(INTEL_DARK_NICK_SHORT), "U+2800 note");
  // 通知理由字串會帶出「冒名」
  const reason = `（${r.join("、")}）`;
  assert.match(reason, /冒名/);
});

test("1030：記事本掃描路徑套用暗稱辨識（guard.mjs handleNote）", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const noteFn = src.indexOf("async function handleNote");
  assert.ok(noteFn > 0);
  const next = src.indexOf("\nasync function ", noteFn + 10);
  const body = src.slice(noteFn, next > 0 ? next : noteFn + 4000);
  assert.match(body, /darkNickNotifyReasons/);
  assert.match(body, /nickReasons/);
  assert.match(body, /mergedNames/);
  assert.match(body, /appendUnresolvedShortReport/);
});
