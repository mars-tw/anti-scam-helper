// 平台官方短網址與主流內容網址：本身不是詐騙依據（10/22 連結誤判整批修正）。範例全為虛構代碼。
import test from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer, forcedScamNames, SHORTENERS, PLATFORM_SHORTENERS } from "../guard/rules.mjs";
import { isMainstreamMediaHost, onlyMainstreamMediaLinks } from "../guard/notify-rules.mjs";

const score = makeRuleScorer();

test("平台官方短網址分享：0 分、不觸發疑似短網址", () => {
  for (const t of [
    "【《某節目》第五集-哔哩哔哩】 https://b23.tv/AbCd123",
    "https://youtu.be/abcDEF12345",
    "看這篇 https://t.co/AbCdEf",
    "https://redd.it/abc12",
    "https://maps.app.goo.gl/AbCdEf",
    "https://spoti.fi/AbCd",
    "https://vm.tiktok.com/ZAbCd/",
    "https://xhslink.com/AbCd",
    "https://amzn.to/AbCd12",
    "https://www.youtube.com/watch?v=C0de0000000",
    "https://www.pionex.com/zh-TW/",
  ]) {
    const r = score({}, t);
    assert.equal(r.score, 0, t);
    assert.deepEqual(forcedScamNames(r.names), [], t);
    assert.ok(onlyMainstreamMediaLinks(t), t);
  }
});

test("不明短網域與通用短網址照舊可疑", () => {
  assert.ok(score({}, "https://ab.io/xY12z").names.includes("疑似短網址"));
  assert.ok(score({}, "https://bit.ly/abc").names.includes("短網址"));
  assert.ok(!SHORTENERS.includes("t.co"));
});

test("仿冒平台網域不算主流", () => {
  assert.equal(isMainstreamMediaHost("b23.tv.scam-example.test"), false);
  assert.equal(isMainstreamMediaHost("fakeyoutu.be"), false);
  assert.equal(isMainstreamMediaHost("m.bilibili.com"), true);
  assert.ok(score({}, "https://youtube.com.scam-example.test/x").names.includes("網址"));
});

test("平台連結配引流字眼照樣計分", () => {
  const r = score({}, "https://b23.tv/AbCd123 穩賺不賠 私我帶單");
  assert.ok(r.score >= 4);
});

test("LINE 邀請不因平台清單放行", () => {
  assert.ok(!PLATFORM_SHORTENERS.includes("lin.ee"));
  assert.ok(score({}, "https://line.me/ti/g2/AbCdEf").names.includes("群組邀請連結"));
});
