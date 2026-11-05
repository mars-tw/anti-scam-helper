// 士軒 11/5 18:21：短網址一律展開；展開後落 LINE 群組／社群邀請 → strong-gate 強特徵（≥6）；
// 已確認邀請碼進特徵庫（真碼只在本機 data/，測試用假碼）。對抗：多層短網址、大小寫、帶參數；
// 自查：直接貼非短網址正常群邀不變；一般短網址落正常頁低分不發；展開失敗／CF 既有路徑；
// excludeChats／Hao 三群／頂層 notify／一頁式與「加新群配外部網址」未決項不碰。
import assert from "node:assert/strict";
import test from "node:test";
import { outboundGate, strongFeature, STRONG_SHORT_INVITE, STRONG_MIN_SCORE } from "../guard/strong-gate.mjs";
import { KICK_FAKE_GROUP, kickScopeDecision, kickCategory } from "../guard/kick-scope.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";
import { shortUrlExpandOutcome } from "../guard/short-url-outcome.mjs";
import { makeRuleScorer, FORCED_SCAM_NAMES } from "../guard/rules.mjs";
import { CERTAIN_FEATURES } from "../guard/notify-rules.mjs";
import {
  KNOWN_SCAM_INVITE, inviteTicketsIn, knownScamInviteHits, hasKnownScamInvite, normalizeInviteTickets,
} from "../guard/known-scam-invite.mjs";

const TICKET = "TestScamInviteTicket1105AaBbCcDdEeFf";
const OTHER = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const INVITE = `https://line.me/ti/g2/${TICKET}`;
const OPENCHAT = `https://openchat.line.me/tw/cover/${TICKET}`;

const resolveOk = async () => [{ address: "93.184.216.34" }];
function res(status, { location, html = "", type = "text/html", server } = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: {
      get: (k) => {
        const key = String(k).toLowerCase();
        if (key === "location") return location ?? null;
        if (key === "content-type") return type;
        if (key === "server") return server ?? null;
        return null;
      },
      has: (k) => String(k).toLowerCase() === "cf-ray" && server === "cloudflare",
    },
    body: { getReader: () => { let done = false; return { read: async () => (done ? { done: true } : ((done = true), { done: false, value: Buffer.from(html) })), cancel: async () => {} }; } },
  };
}

test("短網址展開成群組邀請 → strong-gate 強特徵、有效分數≥6（不靠雙 LLM SCAM）", () => {
  const names = ["子網域短網址", "短網址導向群組邀請"];
  const entry = { score: 0, names, verdict: "OK", review: "OK" };
  assert.equal(strongFeature(entry, { text: "user351595.pse.is/9tk57c" }), STRONG_SHORT_INVITE);
  const g = outboundGate(entry, { text: "user351595.pse.is/9tk57c" });
  assert.equal(g.send, true);
  assert.equal(g.feature, STRONG_SHORT_INVITE);
  assert.ok(g.score >= STRONG_MIN_SCORE);
  // 沒有換群字、也沒雙 SCAM → kickCategory 仍 undefined（頂層 notify 只通知不踢）
  assert.equal(kickCategory({ text: "user351595.pse.is/9tk57c", names, inviteExpanded: true }), undefined);
});

test("已知詐騙邀請碼 → 強特徵；規則分數≥6；FORCED／CERTAIN 含名稱", () => {
  assert.ok(FORCED_SCAM_NAMES.has(KNOWN_SCAM_INVITE));
  assert.ok(CERTAIN_FEATURES.has(KNOWN_SCAM_INVITE));
  const rs = makeRuleScorer([], { scamInviteTickets: [TICKET] });
  const hit = rs({}, INVITE);
  assert.ok(hit.names.includes(KNOWN_SCAM_INVITE));
  assert.ok(hit.score >= 6);
  assert.equal(strongFeature({ score: hit.score, names: hit.names }), STRONG_SHORT_INVITE);
  assert.equal(outboundGate({ score: hit.score, names: hit.names, verdict: "OK", review: "OK" }, { text: INVITE }).send, true);
});

test("直接貼非短網址的正常群組邀請：行為不變（有換群字→換群強特徵；純邀請無換群／無確認碼→不因本改動變強）", () => {
  const move = "本群解散請搬到新群 https://line.me/ti/g2/" + OTHER;
  assert.equal(strongFeature({ score: 7, names: ["假群組公告", "群組邀請連結"], verdict: "SCAM", review: "SCAM" }, { text: move }), KICK_FAKE_GROUP);
  // 純邀請、無已知碼、無雙 SCAM、無換群字 → 不算強特徵（維持舊行為）
  const plain = outboundGate({ score: 6, names: ["群組邀請連結", "LINE 邀請／加好友"], verdict: "OK", review: "OK" }, { text: `https://line.me/ti/g2/${OTHER}` });
  assert.equal(plain.send, false);
  assert.equal(plain.reason, "no-strong-feature");
});

test("一般短網址落正常頁 → 低分不發話", () => {
  const g = outboundGate({ score: 0, names: [], verdict: "OK", review: "OK" }, { text: "看這篇 https://reurl.cc/abc → https://github.com/mars-tw/x" });
  assert.equal(g.send, false);
  const out = shortUrlExpandOutcome({ expanded: { url: "https://github.com/mars-tw/x", html: "<title>docs</title>" }, stillShortener: false });
  assert.equal(out.result, "normal");
  assert.deepEqual(out.extraNames, []);
});

test("展開失敗／CF 挑戰：既有路徑（unreachable／無 invite 名稱）", async () => {
  assert.equal(shortUrlExpandOutcome({ expanded: undefined }).result, "unreachable");
  const cf = await expandUrlSafe("https://pse.is/x", {
    fetchImpl: async () => res(403, { html: "<html>Just a moment... cf-browser-verification</html>", server: "cloudflare" }),
    resolve: resolveOk,
  });
  // CF 挑戰頁通常無 invite；outcome 不應誤標 invite
  const o = shortUrlExpandOutcome({ expanded: cf ?? undefined, stillShortener: false });
  assert.notEqual(o.result, "invite");
});

test("excludeChats／Hao warnOnly：強特徵可發通知但不踢；頂層 notify 不因本改動變 kick", () => {
  const text = "https://user351595.pse.is/9tk57c";
  const names = ["短網址導向群組邀請"];
  assert.equal(outboundGate({ score: 0, names }, { text }).send, true);
  for (const scope of [{ excludeChats: ["bear"] }, { warnOnly: new Set(["hao1"]) }, { learnOnly: new Set(["learn"]) }]) {
    assert.equal(kickScopeDecision({ chatId: "bear", text, names, verdict: "OK", review: "OK", scope }).kick, false);
    assert.equal(kickScopeDecision({ chatId: "hao1", text, names, verdict: "SCAM", review: "SCAM", scope }).kick, false);
  }
});

test("對抗：多層短網址 → 最終群邀請仍標 invite", async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    n += 1;
    const s = String(url);
    if (s.includes("bit.ly")) return res(302, { location: "https://reurl.cc/hop2" });
    if (s.includes("reurl.cc")) return res(302, { location: "https://user351595.pse.is/9tk57c" });
    if (s.includes("pse.is")) return res(302, { location: INVITE });
    return res(200, { html: "<html>ok</html>" });
  };
  const out = await expandUrlSafe("https://bit.ly/hop1", { fetchImpl, resolve: resolveOk });
  assert.equal(out.invite, true);
  assert.equal(shortUrlExpandOutcome({ expanded: out }).result, "invite");
  assert.ok(n >= 3);
});

test("對抗：大小寫主機／路徑參數仍展開成邀請；邀請碼大小寫精確比對", async () => {
  const fetchImpl = async () => res(302, { location: INVITE + "?utm_source=x&x=1" });
  const out = await expandUrlSafe("https://User351595.PSE.IS/9tk57c?ref=1", { fetchImpl, resolve: resolveOk });
  assert.equal(out.invite, true);
  assert.deepEqual(inviteTicketsIn(INVITE), [TICKET]);
  assert.deepEqual(knownScamInviteHits(INVITE, [TICKET]), [TICKET]);
  // 大小寫不同的碼不算命中（LINE 邀請碼大小寫敏感）
  assert.equal(hasKnownScamInvite(INVITE.replace(TICKET, TICKET.toLowerCase()), [TICKET]), false);
});

test("對抗：HTML 內嵌 line.me／openchat 邀請也算 invite；openchat 直連也算", async () => {
  const html = `<a href="${INVITE}">join</a>`;
  const out = await expandUrlSafe("https://pse.is/embed", { fetchImpl: async () => res(200, { html }), resolve: resolveOk });
  assert.equal(out.invite, true);
  const oc = await expandUrlSafe(OPENCHAT, { fetchImpl: async () => res(200, { html: "<html/>" }), resolve: resolveOk });
  assert.equal(oc.invite, true);
  assert.deepEqual(inviteTicketsIn(OPENCHAT), [TICKET]);
});

test("已知邀請碼庫：正規化去空白；空碼丟掉；短網址落地 HTML 命中也算", () => {
  assert.deepEqual(normalizeInviteTickets(["  " + TICKET + " ", TICKET, "ab", "abcd"]), [TICKET, "abcd"]);
  const html = `<html><a href="https://line.me/ti/g2/${TICKET}">x</a></html>`;
  assert.ok(hasKnownScamInvite(html, [TICKET]));
  assert.equal(hasKnownScamInvite("https://line.me/ti/g2/" + OTHER, [TICKET]), false);
});

test("原始碼：shortUrlExpand 預設開（!== false）；strong-gate 認短網址邀請／已知碼", async () => {
  const { readFileSync } = await import("node:fs");
  const guard = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(guard, /shortUrlExpand !== false/);
  assert.doesNotMatch(guard, /shortUrlExpand === true/);
  const sg = readFileSync(new URL("../guard/strong-gate.mjs", import.meta.url), "utf8");
  assert.match(sg, /STRONG_SHORT_INVITE|短網址導向群組邀請/);
  assert.match(sg, /KNOWN_SCAM_INVITE|已知詐騙群組邀請/);
});
