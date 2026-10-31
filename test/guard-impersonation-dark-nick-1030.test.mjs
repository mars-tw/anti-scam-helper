// 10/30 晨會／情資：暗稱冒用群主（尾端空白、零寬／NBSP、暱稱寫成 @群主名）要穩定識別。
// 只改善識別驗證，不新增踢人情境：尾端一般空白／純 @ 無 invisible → 不升級踢；
// 三種群（踢人／非踢人／Hao0321 只警告）＋對抗（真群管、善意提問、路人暱稱）。
import test from "node:test";
import assert from "node:assert/strict";
import { looksLike, containsNameToken } from "../guard/policy.mjs";
import { analyzeName } from "../guard/fakeadmin.mjs";
import { decideImpersonationKick, hasInvisibleChars, looksLikeAntiScamBot } from "../guard/impersonation-kick.mjs";
import { canonName } from "../guard/notify-rules.mjs";
import { kickScopeDecision } from "../guard/kick-scope.mjs";

// 與 guard.mjs normalizeName 相同（未 export，測試內複寫並鎖住行為）。
const normalizeName = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{C}\p{M}\u115F\u1160\u3164\uFFA0]/gu, "");

const OWNER = "群主小明";
const ownerKey = normalizeName(OWNER);
const looks = (a, b) => looksLike(a, b);
const FAKE_INVITE = "本群明天要刪除，請大家加入新二群 https://line.me/ti/g2/AbCdEfGh";
const SHORT_NOTE = "請看記事本短網址 https://bit.ly/x9k2m";
const baseKick = {
  adminNames: [OWNER],
  normalizeName,
  looksLike: looks,
  text: FAKE_INVITE,
  ruleNames: ["假群組公告"],
  verdict: "SCAM",
  model: "local-vlm",
  review: "SCAM",
  excluded: false,
};
// 測試用假聊天室 id（對應踢人群／一般群／Hao0321 只警告三群／熊群／只學習）
const scope = {
  excludeChats: ["cBear", "cLearnBot"],
  learnOnly: new Set(["cLearn"]),
  warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]),
};

test("尾端空白（半形／全形／NBSP）正規化後仍 looksLike 同群群主；無 invisible → 不升級踢", () => {
  for (const nick of [OWNER + " ", OWNER + "   ", OWNER + "\u3000", OWNER + "\u00A0"]) {
    const key = normalizeName(nick);
    assert.equal(key, ownerKey, JSON.stringify(nick));
    assert.equal(looksLike(key, ownerKey), true, nick);
    assert.equal(hasInvisibleChars(nick), false, nick);
    assert.equal(analyzeName(nick).signals.some((s) => s.type === "invisible"), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).reason, "no-invisible", nick);
  }
});

test("暱稱寫成 @群主名／全形＠／＠加空白：正規化後仍 looksLike；無 invisible → 不升級踢", () => {
  for (const nick of ["@" + OWNER, "＠" + OWNER, "@ " + OWNER, "＠　" + OWNER, "@" + OWNER + " "]) {
    const key = normalizeName(nick);
    assert.equal(key, ownerKey, nick);
    assert.equal(looksLike(key, ownerKey), true, nick);
    assert.equal(canonName(nick), canonName(OWNER), nick);
    assert.equal(hasInvisibleChars(nick), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).reason, "no-invisible", nick);
  }
});

test("尾端點字空白／零寬／韓文填充字：仍 looksLike，且有 invisible（既有升級路徑，不新增情境）", () => {
  for (const nick of [OWNER + "\u2800", OWNER + "\u200B", OWNER + "\u3164"]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), true, nick);
    assert.equal(hasInvisibleChars(nick), true, nick);
    assert.ok(analyzeName(nick).signals.some((s) => s.type === "invisible"), nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).kick, true, nick);
  }
});

test("三種群：暗稱＋invisible＋假群邀請 — 踢人群可踢；Hao0321 只警告／只學習／熊群不踢；純尾端空白不升級", () => {
  const darkInvisible = OWNER + "\u200B";
  const darkSpace = OWNER + " ";
  const darkAt = "@" + OWNER;
  // 既有升級（invisible）：kickScope 在踢人群可踢，只警告／只學習／熊群不可
  assert.equal(
    kickScopeDecision({
      chatId: "cKick",
      scope,
      impersonating: OWNER,
      text: FAKE_INVITE,
      inviteExpanded: true,
    }).kick,
    true,
  );
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3", "cLearn", "cBear", "cLearnBot"]) {
    assert.equal(
      kickScopeDecision({
        chatId,
        scope,
        impersonating: OWNER,
        text: FAKE_INVITE,
        inviteExpanded: true,
      }).kick,
      false,
      chatId,
    );
  }
  // 暗稱本身：invisible 可升級；尾端空白／@ 不升級（不變後果）
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: darkInvisible }).kick, true);
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: darkSpace }).kick, false);
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: darkAt }).kick, false);
  // 非踢人群（cOther）kickScope 類別仍可踢，實際踢人還看 kickMode；暗稱無 invisible 仍不升級
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: darkSpace }).reason, "no-invisible");
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: darkAt, text: SHORT_NOTE }).reason, "no-invisible");
});

test("對抗：真群管本人（excluded）即使暱稱看起來像暗稱也不升級踢", () => {
  for (const nick of [OWNER, OWNER + " ", "@" + OWNER, OWNER + "\u200B"]) {
    const r = decideImpersonationKick({ ...baseKick, senderName: nick, excluded: true });
    assert.equal(r.kick, false, nick);
    assert.equal(r.reason, "excluded", nick);
  }
  assert.equal(
    kickScopeDecision({
      chatId: "cKick",
      scope,
      excluded: true,
      impersonating: OWNER,
      text: FAKE_INVITE,
      inviteExpanded: true,
    }).kick,
    false,
  );
});

test("對抗：善意提問／防詐提醒不算假群內容升級；路人暱稱不命中", () => {
  const ask = "這是不是冒名？暱稱後面好像有空白";
  // 防詐提醒若夾了假群話術，仍走 anti-scam-bot-like（排在 fakeGroupContent 之後）
  const warnWithFakeGroup = "疑似詐騙，請管理員確認。本群明天要刪除請加入新二群 https://line.me/ti/g2/AbCdEfGh";
  const warnOnly = "提醒大家：有人用 @群主名 冒充，請勿點短網址";
  assert.equal(looksLikeAntiScamBot(warnOnly), true);
  assert.equal(looksLikeAntiScamBot(warnWithFakeGroup), true);
  assert.equal(
    decideImpersonationKick({
      ...baseKick,
      senderName: OWNER + "\u200B",
      text: warnWithFakeGroup,
      ruleNames: [],
    }).reason,
    "anti-scam-bot-like",
  );
  // 純善意詢問：無假群組公告／邀請 → not-fake-group；模型非 SCAM → model-not-scam
  assert.equal(
    decideImpersonationKick({
      ...baseKick,
      senderName: OWNER + "\u200B",
      text: ask,
      ruleNames: [],
      verdict: "UNSURE",
    }).reason,
    "model-not-scam",
  );
  assert.equal(
    decideImpersonationKick({
      ...baseKick,
      senderName: OWNER + "\u200B",
      text: ask,
      ruleNames: [],
    }).reason,
    "not-fake-group",
  );
  // 純防詐提醒（無假群話術）也是 not-fake-group，不升級
  assert.equal(
    decideImpersonationKick({
      ...baseKick,
      senderName: OWNER + "\u200B",
      text: warnOnly,
      ruleNames: [],
    }).reason,
    "not-fake-group",
  );
  for (const nick of ["群主小華 ", "@群主小華", "＠路人甲", "@小華玩家", "玩家小華 ", "  路人乙  ", "小明 "]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).kick, false, nick);
  }
  assert.equal(containsNameToken(normalizeName("小明"), ownerKey), false);
});
