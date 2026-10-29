// 10/29：短網址展開結果分類（unresolved≠normal）＋中繼頁跟 og:url。
// 不 drop「短網址」分數；改寫 decideText 照舊；計分依改寫後（或未改寫）本文。
// 全部假 ID／假網域；測踢人群、非踢人群、Hao0321 只警告三群。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortUrlExpandOutcome } from "../guard/short-url-outcome.mjs";
import { decideAction } from "../guard/policy.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";
import { kickScopeDecision, KICK_FAKE_GROUP } from "../guard/kick-scope.mjs";

const score = makeRuleScorer();
const SHORT = "https://bit.ly/abc12";
const FINAL = "https://example.test/guide";
const PHISH = "https://login-phish.example.test/steal";
const INVITE = "https://line.me/ti/g2/FakeInvite0001";

const resolve = async () => [{ address: "93.184.216.34" }];
const res = (status, { location, html = "", type = "text/html" } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (k) => {
      const key = k.toLowerCase();
      if (key === "location") return location ?? null;
      if (key === "content-type") return type;
      return null;
    },
  },
  body: {
    getReader: () => {
      let done = false;
      const buf = Buffer.from(html);
      return {
        read: async () => (done ? { done: true } : ((done = true), { done: false, value: buf })),
        cancel: async () => {},
      };
    },
  },
});

test("正例：展開結果仍是短網址服務 → unresolved，不可標 normal、不改寫", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: SHORT, html: "<html>中繼</html>" }, stillShortener: true });
  assert.equal(out.result, "unresolved");
  assert.equal(out.rewrite, false);
  assert.deepEqual(out.extraNames, []);
  assert.equal("dropShortenerName" in out, false);
});

test("正例：展開到非短網址落地頁 → normal，rewrite；不帶 dropShortenerName", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: FINAL, html: "<title>文件</title>" }, stillShortener: false });
  assert.equal(out.result, "normal");
  assert.equal(out.rewrite, true);
  assert.equal("dropShortenerName" in out, false);
});

test("正例：導向群組邀請 → invite，不改寫", () => {
  const out = shortUrlExpandOutcome({ expanded: { invite: true, url: INVITE }, stillShortener: false });
  assert.equal(out.result, "invite");
  assert.equal(out.rewrite, false);
  assert.deepEqual(out.extraNames, ["短網址導向群組邀請"]);
});

test("正例：購物落地 → shopping＋rewrite", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: "https://shop.example.test/p/1", html: "加入購物車" }, stillShortener: false, shopping: true });
  assert.equal(out.result, "shopping");
  assert.equal(out.shopWarn, true);
  assert.equal(out.rewrite, true);
});

test("正例：展開失敗 → unreachable", () => {
  assert.equal(shortUrlExpandOutcome({ expanded: undefined }).result, "unreachable");
});

test("分數不變：原文含短網址 → 短網址＋網址＝4 可通知；規則本身未改", () => {
  const before = score({}, `請看 ${SHORT}`);
  assert.ok(before.names.includes("短網址"));
  assert.ok(before.names.includes("網址"));
  assert.equal(before.score, 4);
  assert.equal(decideAction({ score: before.score, verdict: "SCAM", review: "SCAM", names: before.names, notifyScore: 3, link: true }), "notice");
});

test("短網址跳釣魚頁：原文仍保留短網址分；outcome 不 drop；改寫後依落地頁計分（照舊）", () => {
  const original = `請登入 ${SHORT}`;
  const orig = score({}, original);
  assert.ok(orig.names.includes("短網址"), "原文短網址分數必須保留");
  assert.equal(orig.score, 4);

  const out = shortUrlExpandOutcome({ expanded: { url: PHISH, html: "<title>驗證帳戶</title>" }, stillShortener: false });
  assert.equal(out.result, "normal");
  assert.equal(out.rewrite, true);
  assert.equal("dropShortenerName" in out, false);

  // 改寫 decideText 照舊：換成落地頁後依新本文計分（不再命中短網址規則，也不靠 dropNames）
  const rewritten = original.replace(SHORT, PHISH);
  const after = score({}, rewritten);
  assert.ok(!after.names.includes("短網址"));
  assert.ok(after.names.includes("網址"));
  // 原文分數不受 outcome 影響（沒有 dropShortenerName 去改分數）
  assert.equal(score({}, original).score, 4);
  assert.ok(score({}, original).names.includes("短網址"));
});

test("三種群：unresolved 短網址仍可通知；踢人條件不變（踢人／非踢人／Hao0321）", () => {
  const scope = {
    excludeChats: ["cBear"],
    learnOnly: new Set(["cLearn"]),
    warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]),
  };
  const out = shortUrlExpandOutcome({ expanded: { url: SHORT }, stillShortener: true });
  assert.equal(out.result, "unresolved");
  assert.equal(out.rewrite, false);
  const names = score({}, `看 ${SHORT}`).names;
  assert.ok(names.includes("短網址"));
  const action = decideAction({ score: 4, verdict: "SCAM", review: "SCAM", names, notifyScore: 3, link: true });
  assert.equal(action, "notice");
  // 純短網址＋雙 SCAM：三種群都不因短網址單獨觸發踢人
  for (const chatId of ["cKick", "cNormal", "cWarn1"]) {
    const r = kickScopeDecision({
      chatId, scope,
      text: `分享 ${SHORT}`,
      inviteExpanded: false,
      impersonating: undefined,
      verdict: "SCAM", review: "SCAM",
    });
    assert.equal(r.kick, false, chatId);
  }
});

test("對抗：invite 不可被 normal 邏輯放行；踢人群＋冒名＋invite 仍可踢；只警告三群不踢", () => {
  const out = shortUrlExpandOutcome({ expanded: { invite: true, url: INVITE } });
  assert.equal(out.result, "invite");
  assert.equal(out.rewrite, false);
  const scope = { excludeChats: ["cBear"], learnOnly: new Set(["cLearn"]), warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]) };
  const kick = kickScopeDecision({
    chatId: "cKick", scope,
    text: `快來 ${SHORT}`,
    inviteExpanded: true, impersonating: "群主甲",
    verdict: "SCAM", review: "SCAM",
  });
  assert.equal(kick.kick, true);
  assert.equal(kick.category, KICK_FAKE_GROUP);
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3"]) {
    assert.equal(kickScopeDecision({
      chatId, scope, text: `快來 ${SHORT}`, inviteExpanded: true, impersonating: "群主甲",
      verdict: "SCAM", review: "SCAM",
    }).kick, false, chatId);
  }
});

test("展開：短網址中繼頁用 og:url 指向落地 → 跟到下一跳", async () => {
  const html = '<html><head><meta property="og:url" content="https://example.test/guide"><title>跳轉中</title></head></html>';
  const fetchImpl = async (u) => {
    const s = String(u);
    if (s.includes("bit.ly")) return res(200, { html });
    return res(200, { html: "<html><head><title>文件指南</title></head><body>教學</body></html>" });
  };
  const out = await expandUrlSafe("https://bit.ly/abc12", { fetchImpl, resolve });
  assert.ok(out);
  assert.equal(out.invite, false);
  assert.match(out.url, /example\.test/);
  const still = /bit\.ly/i.test(out.url);
  assert.equal(still, false);
  const outcome = shortUrlExpandOutcome({ expanded: out, stillShortener: still });
  assert.equal(outcome.result, "normal");
  assert.equal(outcome.rewrite, true);
});

test("展開對抗：og:url 仍指向同短網址主機 → 不跟、標 unresolved", async () => {
  const html = '<html><head><meta property="og:url" content="https://bit.ly/abc12"></head><body>中繼</body></html>';
  const out = await expandUrlSafe("https://bit.ly/abc12", { fetchImpl: async () => res(200, { html }), resolve });
  assert.ok(out);
  assert.match(out.url, /bit\.ly/i);
  const outcome = shortUrlExpandOutcome({ expanded: out, stillShortener: true });
  assert.equal(outcome.result, "unresolved");
  assert.equal(outcome.rewrite, false);
  // unresolved 本文未改寫 → 短網址分數照舊
  assert.ok(score({}, `看 ${SHORT}`).names.includes("短網址"));
});

test("原始碼：guard 用 shortUrlExpandOutcome；禁止 dropShortenerName／drop「短網址」", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../guard/short-url-outcome.mjs", import.meta.url), "utf8");
  assert.match(src, /shortUrlExpandOutcome/);
  assert.match(src, /result: outcome\.result/);
  assert.doesNotMatch(src, /dropShortenerName/);
  assert.doesNotMatch(helper, /dropShortenerName/);
  assert.doesNotMatch(helper, /shortUrlNormalShouldQuiet/);
  assert.doesNotMatch(src, /dropShortenerName \? \["短網址"\]/);
  assert.ok(SHORTENERS.includes("bit.ly"));
});
