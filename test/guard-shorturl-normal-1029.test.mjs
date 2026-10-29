// 10/29：Pan 群短網址展開誤標 normal、仍以「短網址」4 分通知。
// 修正：展開後仍停在短網址服務 → unresolved；真正落地 → rewrite＋去掉「短網址」分數。
// 全部假 ID／假網域；測踢人群、非踢人群、Hao0321 只警告三群。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortUrlExpandOutcome, shortUrlNormalShouldQuiet } from "../guard/short-url-outcome.mjs";
import { decideAction } from "../guard/policy.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";
import { kickScopeDecision, KICK_FAKE_GROUP } from "../guard/kick-scope.mjs";

const score = makeRuleScorer();
const SHORT = "https://bit.ly/abc12";
const FINAL = "https://example.test/guide";
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

test("正例：展開結果仍是短網址服務 → unresolved，不可標 normal、不可 drop", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: SHORT, html: "<html>中繼</html>" }, stillShortener: true });
  assert.equal(out.result, "unresolved");
  assert.equal(out.rewrite, false);
  assert.equal(out.dropShortenerName, false);
  assert.deepEqual(out.extraNames, []);
});

test("正例：展開到非短網址落地頁 → normal，rewrite＋drop 短網址", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: FINAL, html: "<title>文件</title>" }, stillShortener: false });
  assert.equal(out.result, "normal");
  assert.equal(out.rewrite, true);
  assert.equal(out.dropShortenerName, true);
});

test("正例：導向群組邀請 → invite，不加 drop", () => {
  const out = shortUrlExpandOutcome({ expanded: { invite: true, url: INVITE }, stillShortener: false });
  assert.equal(out.result, "invite");
  assert.deepEqual(out.extraNames, ["短網址導向群組邀請"]);
  assert.equal(out.dropShortenerName, false);
});

test("正例：購物落地 → shopping＋rewrite＋drop", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: "https://shop.example.test/p/1", html: "加入購物車" }, stillShortener: false, shopping: true });
  assert.equal(out.result, "shopping");
  assert.equal(out.shopWarn, true);
  assert.equal(out.dropShortenerName, true);
});

test("正例：展開失敗 → unreachable", () => {
  assert.equal(shortUrlExpandOutcome({ expanded: undefined }).result, "unreachable");
});

test("分數：純短網址 4 分會通知；展開後只剩網址 1 分＋雙 SCAM → 不通知（10/22）", () => {
  const before = score({}, `請看 ${SHORT}`);
  assert.ok(before.names.includes("短網址"));
  assert.equal(before.score, 4);
  assert.equal(decideAction({ score: before.score, verdict: "SCAM", review: "SCAM", names: before.names, notifyScore: 3, link: true }), "notice");

  const after = score({}, `請看 ${FINAL}`);
  assert.ok(!after.names.includes("短網址"));
  assert.equal(after.score, 1);
  assert.equal(decideAction({ score: after.score, verdict: "SCAM", review: "SCAM", names: after.names, notifyScore: 3, link: true }), "none");
  assert.equal(shortUrlNormalShouldQuiet({ outcome: { result: "normal", dropShortenerName: true }, scoreAfterDrop: 1, notifyScore: 3 }), true);
});

test("三種群：normal 展開後只剩網址 → 踢人／非踢人／Hao0321 皆不因短網址通知；踢人條件不變", () => {
  const scope = {
    excludeChats: ["cBear"],
    learnOnly: new Set(["cLearn"]),
    warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]),
  };
  const namesAfter = ["網址"];
  const action = decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: namesAfter, notifyScore: 3, link: true });
  assert.equal(action, "none");
  // 三種群：通知層都不該只靠短網址；踢人要另有群邀請等
  for (const chatId of ["cKick", "cNormal", "cWarn1"]) {
    const r = kickScopeDecision({
      chatId, scope,
      text: `分享 ${FINAL}`,
      inviteExpanded: false,
      impersonating: undefined,
      verdict: "SCAM", review: "SCAM",
    });
    assert.equal(r.kick, false, chatId);
  }
});

test("對抗：unresolved 不可放行（仍應保留短網址分數可通知）", () => {
  const out = shortUrlExpandOutcome({ expanded: { url: SHORT }, stillShortener: true });
  assert.equal(out.dropShortenerName, false);
  const before = score({}, `看 ${SHORT}`);
  assert.equal(decideAction({ score: before.score, verdict: "SCAM", review: "SCAM", names: before.names, notifyScore: 3, link: true }), "notice");
  assert.equal(shortUrlNormalShouldQuiet({ outcome: out, scoreAfterDrop: before.score, notifyScore: 3 }), false);
});

test("對抗：invite 不可因 normal 邏輯放行；踢人群＋冒名＋invite 仍可踢", () => {
  const out = shortUrlExpandOutcome({ expanded: { invite: true, url: INVITE } });
  assert.equal(out.result, "invite");
  assert.equal(out.dropShortenerName, false);
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

test("展開：短網址中繼頁用 og:url 指向落地 → 跟到下一跳（修 mislabel normal）", async () => {
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
});

test("展開對抗：og:url 仍指向同短網址主機 → 不跟、標 unresolved", async () => {
  const html = '<html><head><meta property="og:url" content="https://bit.ly/abc12"></head><body>中繼</body></html>';
  const out = await expandUrlSafe("https://bit.ly/abc12", { fetchImpl: async () => res(200, { html }), resolve });
  assert.ok(out);
  assert.match(out.url, /bit\.ly/i);
  const outcome = shortUrlExpandOutcome({ expanded: out, stillShortener: true });
  assert.equal(outcome.result, "unresolved");
});

test("原始碼：guard 使用 shortUrlExpandOutcome，且 dropNames 含短網址", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /shortUrlExpandOutcome/);
  assert.match(src, /dropShortenerName \? \["短網址"\]/);
  assert.match(src, /result: outcome\.result/);
  // 確認 SHORTENERS 清單仍含常見服務（不印金鑰）
  assert.ok(SHORTENERS.includes("bit.ly"));
});
