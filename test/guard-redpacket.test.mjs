import { test } from "node:test";
import assert from "node:assert/strict";
import { isRedPacketOnly, lookalikeExchange, redPacketRule } from "../guard/redpacket.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const score = makeRuleScorer();

test("官方紅包連結：派網、幣安、OKX、Bybit、LINE Pay 都算", () => {
  for (const url of [
    "https://www.pionex.com/zh-TW/red-packet/AbC123",
    "https://s.binance.com/AbCd1234",
    "https://app.binance.com/uni-qr/3Fog32zV?utm_medium=web_share_copy",
    "https://www.binance.com/zh-TC/my/wallet/account/payment/cryptobox",
    "https://www.okx.com/zh-hant/red-packet/xyz",
    "https://www.bybit.com/zh-TW/redpacket/claim?code=1",
    "https://pay.line.me/tw/xxx",
  ]) assert.ok(redPacketRule(url), url);
});

test("仿冒網域、子網域騙術、短網址、一般交易所頁面都不算紅包", () => {
  for (const url of [
    "https://pi0nex.com/red-packet/1",
    "https://pionex.com.red-packet.xyz/1",
    "https://binance-redpacket.xyz/claim",
    "https://reurl.cc/abc",
    "https://www.pionex.com/zh-TW/signUp?r=abc",
    "https://user:pw@www.pionex.com/red-packet/1",
  ]) assert.equal(redPacketRule(url), undefined, url);
});

test("整則訊息：只有官方紅包連結才放行；夾帶加賴／私訊／付費字眼或其他連結不放行", () => {
  assert.equal(isRedPacketOnly("🧧 派網紅包 https://www.pionex.com/zh-TW/red-packet/AbC123 搶到的說一聲").ok, true);
  assert.equal(isRedPacketOnly("https://s.binance.com/AbCd1234").ok, true);
  assert.equal(isRedPacketOnly("紅包 https://www.pionex.com/zh-TW/red-packet/AbC 領不到私訊我").reason, "lure");
  assert.equal(isRedPacketOnly("紅包 https://s.binance.com/AbCd1234 先付手續費").reason, "lure");
  assert.equal(isRedPacketOnly("紅包 https://s.binance.com/AbCd1234 https://reurl.cc/x").reason, "other-link");
  assert.equal(isRedPacketOnly("今天有紅包嗎").reason, "no-link");
  assert.equal(isRedPacketOnly("https://foo.example/red-packet/1", { extra: ["foo.example"] }).ok, true);
});

test("規則：假紅包引流、仿冒交易所網域會加分；官方紅包本身不加分", () => {
  assert.ok(score({}, "領紅包請加我line abc").names.includes("假紅包"));
  assert.ok(score({}, "https://pi0nex-gift.com/red-packet 領紅包").names.includes("仿冒交易所網域"));
  assert.ok(score({}, "https://bybit.com.evil.io/redpacket").names.includes("仿冒交易所網域"));
  assert.ok(!score({}, "https://www.pionex.com/zh-TW/red-packet/abc").names.includes("仿冒交易所網域"));
  assert.ok(!score({}, "https://academy.binance.com/zh-TC/articles/x").names.includes("仿冒交易所網域"));
  assert.ok(!score({}, "https://share.pionexapp.com/s/abc").names.includes("仿冒交易所網域"));
  assert.equal(lookalikeExchange("https://binance-gift.xyz/a"), true);
  assert.equal(lookalikeExchange("https://www.binance.com/a"), false);
  assert.equal(lookalikeExchange("https://share.pionexapp.com/s/abc"), false);
  assert.equal(lookalikeExchange("https://pionexapp.com.evil.xyz/a"), true);
});

test("記事本連結白名單：只認完全相同的連結（短網址代碼分大小寫）、沒有引流字眼", async () => {
  const { allLinksKnown, linkKey } = await import("../guard/redpacket.mjs");
  const known = new Set([linkKey("https://lihi2.me/AbC12"), linkKey("https://www.example.org/course/intro?ref=1")]);
  assert.equal(linkKey("http://www.Example.org/course/intro/"), "example.org/course/intro");
  assert.equal(allLinksKnown("課程介紹 https://example.org/course/intro", known).ok, true);
  assert.equal(allLinksKnown("看這裡 lihi2.me/AbC12", known).ok, true);
  assert.equal(allLinksKnown("看這裡 lihi2.me/abc12", known).reason, "other-link");
  assert.equal(allLinksKnown("https://lihi2.me/AbC12 https://reurl.cc/x", known).reason, "other-link");
  assert.equal(allLinksKnown("https://lihi2.me/AbC12 有問題私訊我", known).reason, "lure");
  assert.equal(allLinksKnown("沒有連結", known).reason, "no-link");
  assert.equal(allLinksKnown("https://lihi2.me/AbC12", new Set()).reason, "empty");
});

test("記事本連結白名單：YouTube 影片／Drive 檔案只認同一支（v、id 參數留在鍵裡）", async () => {
  const { allLinksKnown, linkKey } = await import("../guard/redpacket.mjs");
  assert.equal(linkKey("https://www.youtube.com/watch?v=abcDEF123&t=8s&list=PLx"), "youtube.com/watch?v=abcDEF123");
  assert.equal(linkKey("https://drive.google.com/open?id=XyZ&usp=sharing"), "drive.google.com/open?id=XyZ");
  const known = new Set([linkKey("https://www.youtube.com/watch?v=abcDEF123&t=8s")]);
  assert.equal(allLinksKnown("教學 https://youtube.com/watch?v=abcDEF123", known).ok, true);
  assert.equal(allLinksKnown("教學 https://youtube.com/watch?v=other999", known).reason, "other-link");
  assert.equal(allLinksKnown("https://youtube.com/watch", known).reason, "other-link");
});
