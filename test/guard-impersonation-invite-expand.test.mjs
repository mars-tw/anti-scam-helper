// 冒名＋群組邀請：判斷前先展開短網址（維護者 10/29）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inviteExpandOutcome,
  probeInviteShortUrl,
  impersonationInviteIsGroupy,
  shouldDeferImpersonationForExpandFail,
} from "../guard/invite-expand.mjs";
import { kickScopeDecision, KICK_FAKE_GROUP, unrecognizedLinkAction } from "../guard/kick-scope.mjs";
import { looksLike, containsNameToken } from "../guard/policy.mjs";
const normalizeName = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}\p{C}\p{M}\u115F\u1160\u3164\uFFA0]/gu, "");
import { PLATFORM_SHORTENERS, SHORTENERS } from "../guard/rules.mjs";

const SHORT_URL = new RegExp(
  `(?:https?:\\/\\/)?(?<![\\w.-])(?:[a-z0-9-]+\\.)*(?:${SHORTENERS.map((d) => d.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})\\/[\\w\\/?=&%.~-]+`,
  "i",
);

// ── 正例：短網址展開成群邀請 ─────────────────────────────────
test("正例：展開結果 invite=true → inviteExpanded", () => {
  assert.deepEqual(inviteExpandOutcome({ invite: true, url: "https://line.me/ti/g2/AbC" }), {
    inviteExpanded: true, expandFailed: false, expandedUrl: "https://line.me/ti/g2/AbC",
  });
});

test("正例：probe 短網址展開成群邀請 → inviteExpanded", async () => {
  const expand = async () => ({ invite: true, url: "https://line.me/ti/g2/AbC" });
  const out = await probeInviteShortUrl("快加入 https://bit.ly/xYz12", { shortUrlRe: SHORT_URL, expand });
  assert.equal(out.inviteExpanded, true);
  assert.equal(out.expandFailed, false);
  assert.ok(out.shortUrl);
});

test("正例：groupy＝展開成功或直接群邀請或 QR", () => {
  assert.equal(impersonationInviteIsGroupy({ inviteExpanded: true }), true);
  assert.equal(impersonationInviteIsGroupy({ text: "來 https://line.me/ti/g2/AbC" }), true);
  assert.equal(impersonationInviteIsGroupy({ qrContent: "https://line.me/ti/g/xyz" }), true);
});

test("正例：踢人群＋冒名＋inviteExpanded → kickScope 可踢", () => {
  const scope = { excludeChats: ["cExcl"], learnOnly: new Set(["cLearn"]), warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]) };
  const r = kickScopeDecision({
    chatId: "cKick", scope,
    text: "快來 https://bit.ly/xYz12",
    inviteExpanded: true, impersonating: "群主甲",
  });
  assert.equal(r.kick, true);
  assert.equal(r.category, KICK_FAKE_GROUP);
});

// ── 反例 ─────────────────────────────────────────────────────
test("反例：展開成一般頁 → 不是群邀請", () => {
  assert.deepEqual(inviteExpandOutcome({ invite: false, url: "https://docs.example.com/a" }), {
    inviteExpanded: false, expandFailed: false, expandedUrl: "https://docs.example.com/a",
  });
  assert.equal(impersonationInviteIsGroupy({ text: "看 https://bit.ly/abc", inviteExpanded: false }), false);
});

test("反例：真管理員／白名單用 excluded；一般連結不靠展開踢", () => {
  const scope = { excludeChats: [], learnOnly: new Set(), warnOnly: new Set() };
  assert.equal(kickScopeDecision({
    chatId: "cKick", scope, excluded: true,
    text: "https://line.me/ti/g2/AbC", inviteExpanded: true, impersonating: "群主甲",
  }).kick, false);
  assert.equal(kickScopeDecision({
    chatId: "cKick", scope,
    text: "看 https://example.com/page", inviteExpanded: false, impersonating: "群主甲",
  }).kick, false, "一般連結＋冒名不在踢人類別");
});

test("反例：主流平台官方短網址不在 SHORTENERS，probe 不會當已知短網址展開", async () => {
  for (const host of ["youtu.be", "b23.tv", "shp.ee", "xhslink.com", "maps.app.goo.gl"]) {
    assert.ok(PLATFORM_SHORTENERS.includes(host) || PLATFORM_SHORTENERS.some((d) => d.includes(host.split(".")[0])), host);
    assert.equal(SHORTENERS.includes(host), false, host);
  }
  let called = 0;
  const expand = async () => { called++; return { invite: true }; };
  const out = await probeInviteShortUrl("影片 https://youtu.be/dQw4w9WgXcQ", { shortUrlRe: SHORT_URL, expand });
  assert.equal(out.inviteExpanded, false);
  assert.equal(called, 0);
});

// ── 三種群 ───────────────────────────────────────────────────
test("三種群：踢人群可踢；非踢人／只警告／只學習不踢", () => {
  const scope = {
    excludeChats: ["cBear", "cLearnBot"],
    learnOnly: new Set(["cLearn"]),
    warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]), // 只警告三群（測試用假 id）
  };
  const content = { text: "快加入 https://bit.ly/x", inviteExpanded: true, impersonating: "群主甲" };
  assert.equal(kickScopeDecision({ chatId: "cKick", scope, ...content }).kick, true);
  assert.equal(kickScopeDecision({ chatId: "cOther", scope, ...content }).kick, true, "非排除群仍可依類別踢（實際踢人還看 kickMode／per-chat）");
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3", "cLearn", "cBear", "cLearnBot"]) {
    assert.equal(kickScopeDecision({ chatId, scope, ...content }).kick, false, chatId);
  }
});

// ── 對抗 ─────────────────────────────────────────────────────
test("對抗：暱稱全形／加空格仍 looksLike／containsNameToken", () => {
  const admin = normalizeName("群主小明");
  assert.equal(looksLike(normalizeName("群　主　小　明"), admin), true);
  assert.equal(looksLike(normalizeName("群主 小明"), admin), true);
  assert.equal(looksLike(normalizeName("群主小明✨"), admin), true);
  assert.equal(containsNameToken(normalizeName("我是群主小明助理"), admin), true);
});

test("對抗：短網址多層轉址 — expand 回最終 invite 即算", async () => {
  // probe 只呼叫一次 expand；多層由 expandUrlSafe 內部處理，這裡模擬最終結果。
  const expand = async (url) => {
    assert.match(url, /bit\.ly/);
    return { invite: true, url: "https://line.me/ti/g2/FinalHop" };
  };
  const out = await probeInviteShortUrl("https://bit.ly/hop1", { shortUrlRe: SHORT_URL, expand });
  assert.equal(out.inviteExpanded, true);
  assert.equal(out.expandedUrl, "https://line.me/ti/g2/FinalHop");
});

test("對抗：展開失敗 → expandFailed；不可 groupy；應 defer 給無法辨識", async () => {
  const expand = async () => undefined;
  const out = await probeInviteShortUrl("看 https://bit.ly/dead", { shortUrlRe: SHORT_URL, expand });
  assert.equal(out.expandFailed, true);
  assert.equal(out.inviteExpanded, false);
  assert.equal(impersonationInviteIsGroupy({ text: "看 https://bit.ly/dead", expandFailed: true }), false);
  assert.equal(shouldDeferImpersonationForExpandFail({ expandFailed: true, text: "看 https://bit.ly/dead" }), true);
  // 展開失敗不當成群邀請踢；無法辨識流程只在 cf-challenge 才 act（逾時／網路失敗不算）
  assert.equal(unrecognizedLinkAction({ kind: "timeout", chatId: "cKick", scope: {} }).act, false);
  assert.equal(unrecognizedLinkAction({ kind: "network", chatId: "cKick", scope: {} }).act, false);
  assert.equal(unrecognizedLinkAction({ kind: "cf-challenge", chatId: "cKick", scope: {} }).act, true);
});

test("對抗：展開失敗但訊息已有直接群邀請／QR／假公告 → 不 defer，仍可 groupy", () => {
  assert.equal(shouldDeferImpersonationForExpandFail({
    expandFailed: true, text: "兼 https://line.me/ti/g2/AbC",
  }), false);
  assert.equal(shouldDeferImpersonationForExpandFail({
    expandFailed: true, text: "看 bit.ly/x", qrContent: "https://line.me/ti/g/x",
  }), false);
  assert.equal(shouldDeferImpersonationForExpandFail({
    expandFailed: true, text: "看 bit.ly/x", fakeNotice: true,
  }), false);
  assert.equal(impersonationInviteIsGroupy({
    text: "https://line.me/ti/g2/AbC", expandFailed: true,
  }), true);
});
