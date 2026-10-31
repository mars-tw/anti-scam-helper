import assert from "node:assert/strict";
import test from "node:test";
import { allLinksLegit, fetchPageSafe, isLegitShop, pageSignals, pruneOffenses, scoreScamShop, shopLinks } from "../guard/shop.mjs";

const AD = "LV 精品快閃店 名牌包只要 $399 貨到付款 https://lv-bags-sale.shop/a";

test("一頁式詐騙購物：名牌低價＋貨到付款＋可疑網域 → 確定", () => {
  const links = shopLinks(AD);
  assert.equal(links.length, 1);
  const r = scoreScamShop({ text: AD, links });
  assert.equal(r.level, "confident");
  assert.ok(r.signals.includes("貨到付款"));
  // Meta 判 OK：降為不確定
  assert.equal(scoreScamShop({ text: AD, links, review: "OK" }).level, "unsure");
});

test("訊號不夠：不確定；Meta SCAM 且 ≥3 分才確定", () => {
  const text = "名牌包特賣 https://bagsale.shop/x";
  const links = shopLinks(text);
  assert.equal(scoreScamShop({ text, links }).level, "unsure");
  assert.equal(scoreScamShop({ text, links, review: "SCAM" }).level, "confident");
  assert.equal(scoreScamShop({ text: "看看這個 https://blog.example.com/post", links: shopLinks("看看這個 https://blog.example.com/post") }).level, "none");
});

test("正規電商不判", () => {
  for (const url of ["https://shopee.tw/product/1", "https://www.momoshop.com.tw/goods/123", "https://24h.pchome.com.tw/prod/x", "https://tw.coupang.com/vp/1", "https://tw.buy.yahoo.com/gdsale/1", "https://www.books.com.tw/products/1", "https://www.amazon.com/dp/1", "https://www.rakuten.com.tw/shop/x"]) {
    const text = `LV 名牌包只要 $399 貨到付款 ${url}`;
    assert.equal(shopLinks(text).length, 0, url);
    assert.ok(allLinksLegit(text), url);
  }
  assert.ok(isLegitShop("www.shopee.tw"));
  assert.equal(isLegitShop("shopee-tw.shop"), false);
  assert.equal(allLinksLegit("https://shopee.tw/a https://lv-bags-sale.shop/a"), false);
});

test("頁面訊號：一頁式訂購表單＋貨到付款＋名牌低價", () => {
  const html = `<html><body><h1>Chanel 香奈兒 專櫃正品 快閃出清 只要 $499</h1><form>收件人<input>配送地址<input><button>立即訂購</button></form><p>貨到付款 不滿意可退</p><script>alert(1)</script></body></html>`;
  const s = pageSignals(html);
  for (const name of ["頁面：貨到付款", "頁面：單頁訂購表單", "頁面：名牌低價", "頁面：一頁式"]) assert.ok(s.includes(name), name);
  assert.deepEqual(pageSignals("<html><body><a href='/a'>a</a><p>部落格文章</p></body></html>"), []);
});

test("安全抓頁面：拒絕內網、非 http、帳密網址", async () => {
  const never = async () => { throw new Error("不該抓"); };
  assert.equal(await fetchPageSafe("http://127.0.0.1/x", { fetchImpl: never }), undefined);
  assert.equal(await fetchPageSafe("http://192.168.1.1/x", { fetchImpl: never }), undefined);
  assert.equal(await fetchPageSafe("file:///etc/passwd", { fetchImpl: never }), undefined);
  assert.equal(await fetchPageSafe("http://user:pw@example.com/", { fetchImpl: never }), undefined);
  assert.equal(await fetchPageSafe("http://internal.test/", { fetchImpl: never, resolve: async () => [{ address: "10.0.0.5" }] }), undefined);
  // 轉址到內網也拒絕
  const redirect = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  assert.equal(await fetchPageSafe("http://shop.test/", { fetchImpl: redirect, resolve: async () => [{ address: "93.184.216.34" }] }), undefined);
  // 正常 HTML、限大小
  const ok = async () => new Response("<html>" + "x".repeat(1000) + "</html>", { headers: { "content-type": "text/html" } });
  const html = await fetchPageSafe("http://shop.test/", { fetchImpl: ok, resolve: async () => [{ address: "93.184.216.34" }], maxBytes: 100 });
  assert.equal(html.length, 100);
  const pdf = async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } });
  assert.equal(await fetchPageSafe("http://shop.test/", { fetchImpl: pdf, resolve: async () => [{ address: "93.184.216.34" }] }), undefined);
});

test("違規紀錄 30 天過期", () => {
  const now = 1_800_000_000_000;
  const map = { a: [now - 31 * 86_400_000], b: [now - 31 * 86_400_000, now - 86_400_000], c: "bad" };
  pruneOffenses(map, now);
  assert.deepEqual(map, { b: [now - 86_400_000] });
});
