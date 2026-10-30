// 10/30：派網官方分享網域 pionexapp.com（含 share. 子網域）被「仿冒交易所網域」誤判。
// 放行只限精確網域與其子網域（尾端比對）；對抗假尾碼／連字／錯 TLD／相似字仍要命中。
// 放行不得讓夾帶 LINE 群邀請／加好友／私訊引流的訊息跳過其他規則。
// 三種群（踢人／非踢人／Hao0321 只警告）：仿冒交易所只通知、不進踢人；官方分享 0 分不通知。
import test from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer, MAINSTREAM_CONTENT_DOMAINS } from "../guard/rules.mjs";
import { lookalikeExchange } from "../guard/redpacket.mjs";
import { isMainstreamMediaHost, MINER_KICKABLE, minerAction } from "../guard/notify-rules.mjs";
import { kickScopeDecision, kickCategory } from "../guard/kick-scope.mjs";

const score = makeRuleScorer();
const OFFICIAL_URLS = [
  "https://share.pionexapp.com/s/RkbQqHXl?l=en",
  "https://www.pionexapp.com/",
  "https://pionexapp.com/",
  "https://download.pionexapp.com/app",
  "https://www.pionex.com/zh-TW/",
  "https://share.pionex.com/a/wqFpuMBQ",
];
const FAKE_URLS = [
  "https://pionexapp.com.evil.xyz/a",
  "https://www.pionexapp.com.evil.io/x",
  "https://pionex-app.com/a",
  "https://pionexapp.co/a",
  "https://pi0nex.com/a",
  "https://fakepionexapp.com/a",
  "https://pionexapp.com.scam.net/invite",
  "http://xn--pionex-cka.com/a",
];
const scope = {
  excludeChats: ["cBear", "cLearnBot"],
  learnOnly: new Set(["cLearn"]),
  warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]),
};

test("pionexapp.com 已列入主流／官方網域清單（精確字串）", () => {
  assert.ok(MAINSTREAM_CONTENT_DOMAINS.includes("pionexapp.com"));
  assert.ok(MAINSTREAM_CONTENT_DOMAINS.includes("pionex.com"));
  assert.equal(isMainstreamMediaHost("share.pionexapp.com"), true);
  assert.equal(isMainstreamMediaHost("www.pionexapp.com"), true);
  assert.equal(isMainstreamMediaHost("pionexapp.com"), true);
  assert.equal(isMainstreamMediaHost("pionexapp.com.evil.xyz"), false);
  assert.equal(isMainstreamMediaHost("pionex-app.com"), false);
  assert.equal(isMainstreamMediaHost("fakepionexapp.com"), false);
  assert.equal(isMainstreamMediaHost("pionexapp.co"), false);
});

test("官方 pionexapp.com 本身與子網域：不加分、不判仿冒、lookalike=false", () => {
  for (const url of OFFICIAL_URLS) {
    const r = score({}, url);
    assert.equal(r.score, 0, url);
    assert.equal(r.names.includes("仿冒交易所網域"), false, url);
    assert.equal(r.names.includes("網址"), false, url);
    assert.equal(lookalikeExchange(url), false, url);
  }
});

test("對抗：假尾碼／連字號／錯 TLD／前綴仿冒／punycode 仍命中仿冒交易所網域", () => {
  for (const url of FAKE_URLS) {
    const r = score({}, url);
    assert.ok(r.names.includes("仿冒交易所網域"), url + " → " + r.names.join(","));
    assert.ok(r.score >= 5, url);
    assert.equal(lookalikeExchange(url), true, url);
  }
});

test("放行不得跳過其他規則：夾帶群邀請／加好友／私訊引流仍計分", () => {
  const withInvite = score({}, "派網機器人分享 https://share.pionexapp.com/s/abc 請加入 https://line.me/ti/g2/AbCdEfGhIjKl");
  assert.equal(withInvite.names.includes("仿冒交易所網域"), false);
  assert.ok(withInvite.names.includes("群組邀請連結") || withInvite.names.includes("LINE 邀請／加好友"), withInvite.names.join(","));
  assert.ok(withInvite.score >= 3);

  const withFriend = score({}, "網格教學 https://www.pionexapp.com/ 加我 line id: teacher01");
  assert.equal(withFriend.names.includes("仿冒交易所網域"), false);
  assert.ok(withFriend.names.includes("LINE 邀請／加好友"));
  assert.ok(withFriend.score >= 3);

  const withLure = score({}, "紅包 https://share.pionexapp.com/s/x 領不到私訊我");
  assert.equal(withLure.names.includes("仿冒交易所網域"), false);
  assert.ok(withLure.names.includes("私下聯繫") || withLure.names.includes("假紅包"), withLure.names.join(","));
});

test("三種群：官方分享不構成踢人類別；仿冒交易所不在 MINER_KICKABLE", () => {
  assert.equal(MINER_KICKABLE.has("仿冒交易所網域"), false);
  const officialText = "分享機器人 https://share.pionexapp.com/s/RkbQqHXl";
  const officialNames = score({}, officialText).names;
  assert.equal(kickCategory({ text: officialText, names: officialNames, verdict: "OK", review: "OK" }), undefined);

  // 踢人群／非踢人／Hao0321：純官方分享 → kickScope 不踢（沒有踢人類別）
  for (const chatId of ["cKick", "cOther", "cWarn1", "cWarn2", "cWarn3", "cBear", "cLearn"]) {
    const d = kickScopeDecision({
      chatId,
      scope,
      text: officialText,
      names: officialNames,
      verdict: "OK",
      review: "OK",
    });
    assert.equal(d.kick, false, chatId);
  }

  // 仿冒假網域：規則會命中，但 miner／kickScope 仍只通知（不因仿冒交易所升級踢）
  const fakeText = "領紅包 https://pionex-app.com/gift";
  const fakeNames = score({}, fakeText).names;
  assert.ok(fakeNames.includes("仿冒交易所網域"));
  assert.equal(
    minerAction({ perChatKick: true, reasons: ["仿冒交易所網域"], verdict: "SCAM", model: "claude", review: "SCAM" }),
    "notice",
  );
  assert.equal(
    minerAction({ perChatKick: false, reasons: ["仿冒交易所網域"], verdict: "SCAM", model: "claude", review: "SCAM" }),
    "notice",
  );
  for (const chatId of ["cKick", "cOther", "cWarn1"]) {
    const d = kickScopeDecision({
      chatId,
      scope,
      text: fakeText,
      names: fakeNames,
      verdict: "SCAM",
      review: "SCAM",
    });
    assert.equal(d.kick, false, "fake-" + chatId);
  }
});

test("夾帶換群邀請：仍可依既有換群規則在踢人群構成踢人類別（放行網域不擋）", () => {
  const text = "本群明天要刪除，請加入新群 https://line.me/ti/g2/AbCdEfGhIj 參考 https://share.pionexapp.com/s/x";
  const names = score({}, text).names;
  assert.equal(names.includes("仿冒交易所網域"), false);
  assert.ok(names.includes("假群組連結") || names.includes("假群組公告") || names.includes("群組邀請連結"), names.join(","));
  assert.equal(
    kickScopeDecision({
      chatId: "cKick",
      scope,
      text,
      names,
      verdict: "SCAM",
      review: "SCAM",
    }).kick,
    true,
  );
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3", "cBear", "cLearn"]) {
    assert.equal(
      kickScopeDecision({ chatId, scope, text, names, verdict: "SCAM", review: "SCAM" }).kick,
      false,
      chatId,
    );
  }
});
