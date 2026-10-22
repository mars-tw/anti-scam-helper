import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer, forcedScamNames } from "../guard/rules.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";

const r = makeRuleScorer();
test("一般成員發群組邀請／轉移新群／未知短網址 → 一律判詐騙的特徵", () => {
  assert.deepEqual(forcedScamNames(r({}, "來這裡 https://line.me/ti/g2/AbCdEf").names), ["群組邀請連結"]);
  assert.ok(forcedScamNames(r({}, "https://line.me/R/ti/g/xyz").names).includes("群組邀請連結"));
  assert.ok(forcedScamNames(r({}, "請原成員儘快轉移到新群").names).includes("催促加入新群"));
  assert.ok(forcedScamNames(r({}, "看 ab.cd/r/XyZ12").names).includes("疑似短網址"));
  assert.deepEqual(forcedScamNames(r({}, "加我 line.me/R/ti/p/@brand").names), [], "官方帳號不是群組邀請");
  assert.deepEqual(forcedScamNames(r({}, "教學 bit.ly/abc").names), [], "已知短網址服務要先展開，不直接判");
  assert.deepEqual(forcedScamNames(r({}, "https://github.com/a/b").names), []);
});

const resolve = async () => [{ address: "93.184.216.34" }];
const res = (status, { location, html = "", type = "text/html" } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === "location" ? location : k.toLowerCase() === "content-type" ? type : null) },
  body: { getReader: () => { let done = false; return { read: async () => (done ? { done: true } : ((done = true), { done: false, value: Buffer.from(html) })), cancel: async () => {} }; } },
});
test("展開短網址：跟轉址、認出 LINE 群組邀請（轉址或頁面寫死）、擋內網", async () => {
  const hop = async (u) => (String(u).includes("short.example") ? res(302, { location: "https://line.me/ti/g2/AbC" }) : res(200));
  assert.equal((await expandUrlSafe("https://short.example/x", { fetchImpl: hop, resolve })).invite, true);
  const page = async () => res(200, { html: '<script>location="https:\\/\\/line.me\\/ti\\/g2\\/AbC"</script>' });
  assert.equal((await expandUrlSafe("https://short.example/y", { fetchImpl: page, resolve })).invite, true);
  const doc = async (u) => (String(u).includes("short.example") ? res(301, { location: "https://docs.example.com/guide" }) : res(200, { html: "<title>教學文件</title>" }));
  const out = await expandUrlSafe("https://short.example/z", { fetchImpl: doc, resolve });
  assert.equal(out.invite, false); assert.equal(out.url, "https://docs.example.com/guide");
  assert.equal(await expandUrlSafe("https://short.example/z", { fetchImpl: doc, resolve: async () => [{ address: "127.0.0.1" }] }), undefined);
});
