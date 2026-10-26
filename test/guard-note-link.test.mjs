// 10/27：記事本短網址展開只用於評分／通知（B）、一般連結 0 分不貼評分（F）、啟動狀態行（L）。全部假 ID、假網域。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { noteLinkOutcome, shouldPostLinkScore, startupStatusLine } from "../guard/note-link.mjs";
import { kickScopeDecision } from "../guard/kick-scope.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";

const guardSrc = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
const handleNoteSrc = guardSrc.slice(guardSrc.indexOf("async function handleNote("), guardSrc.indexOf("async function drain("));

test("B：記事本短網址導向群組邀請 → 加分（短網址導向群組邀請），處置最多通知，不踢", () => {
  const out = noteLinkOutcome({ expanded: { invite: true }, action: "delete" });
  assert.deepEqual(out.extraNames, ["短網址導向群組邀請"]);
  assert.equal(out.action, "notify");
  assert.equal(out.kick, false);
  assert.deepEqual(noteLinkOutcome({ expanded: { url: "https://docs.example/guide" }, action: "none" }), { extraNames: [], action: "none", kick: false });
  assert.deepEqual(noteLinkOutcome({ expanded: undefined, action: "notify" }), { extraNames: [], action: "notify", kick: false });
});

test("B 對抗：冒充名（夾零寬字元）＋記事本短網址導向群組邀請 → 通知但不踢；只警告三群照舊只警告", async () => {
  const res = (status, { location, html = "" } = {}) => ({ status, headers: { get: (k) => (k.toLowerCase() === "location" ? location ?? null : k.toLowerCase() === "content-type" ? "text/html" : null) }, text: async () => html, body: { cancel() {} } });
  const resolve = async () => [{ address: "93.184.216.34" }];
  const hop = async (u) => (String(u).includes("short.example") ? res(302, { location: "https://line.me/ti/g2/FakeGroup0001" }) : res(200));
  const expanded = await expandUrlSafe("https://short.example/x", { fetchImpl: hop, resolve });
  assert.equal(expanded?.invite, true);
  const authorName = "群\u200b主\u200d小幫手";
  const out = noteLinkOutcome({ expanded, action: "notify" });
  assert.equal(out.action, "notify");
  assert.equal(out.kick, false);
  // 記事本流程本身沒有任何踢人／刪文呼叫（踢人條件不變）。
  assert.ok(!/member:remove|sendKick|remove\(ws/.test(handleNoteSrc), "handleNote 不可踢人");
  assert.ok(/noteLinkOutcome\(\{ expanded, action \}\)/.test(handleNoteSrc));
  const scope = { excludeChats: ["cWarn1", "cWarn2", "cWarn3"], warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]) };
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3"]) assert.equal(kickScopeDecision({ chatId, scope, text: "看這裡 https://short.example/x", inviteExpanded: true, impersonating: authorName, verdict: "SCAM", review: "SCAM" }).kick, false, chatId);
});

test("F：一般連結評分只在 > 0 分時貼；0 分、沒分數、NaN 不貼；其他種類照舊", () => {
  assert.equal(shouldPostLinkScore({ kind: "link-score", score: 3 }), true);
  assert.equal(shouldPostLinkScore({ kind: "link-score", score: 0.5 }), true);
  for (const score of [0, -1, undefined, null, Number.NaN, "3"]) assert.equal(shouldPostLinkScore({ kind: "link-score", score }), false, String(score));
  assert.equal(shouldPostLinkScore({ kind: "suspect", score: 0 }), true);
  assert.equal(shouldPostLinkScore({ kind: "removed" }), true);
  assert.ok(/shouldPostLinkScore\(\{ kind, score: entry\.score \}\)/.test(guardSrc), "notifyAdmins 要套用 0 分不貼");
});

test("L：啟動狀態行只印開關與數量，不印 ID", () => {
  const line = startupStatusLine({ kickScope: { allChats: true, excludeChats: ["cFakeA1", "cFakeB2", "cFakeC3", "cFakeD4", "cFakeE5"] }, fileScan: { enabled: true }, unrecognizedLink: { enabled: false } });
  assert.match(line, /allChats=開/);
  assert.match(line, /excludeChats=5 個/);
  assert.match(line, /fileScan=開/);
  assert.match(line, /unrecognizedLink=關/);
  assert.ok(!/cFake/.test(line));
  assert.match(startupStatusLine({}), /allChats=關、excludeChats=0 個；fileScan=關；unrecognizedLink=關/);
});
