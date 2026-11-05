import assert from "node:assert/strict";
import test from "node:test";
import { outboundGate, strongFeature, effectiveScore, STRONG_BANDAN, STRONG_PHISHING } from "../guard/strong-gate.mjs";
import { KICK_FAKE_GROUP, KICK_SCAM_GROUP, KICK_FAKE_LUXURY, KICK_FAKE_PORN_PDF, kickScopeDecision } from "../guard/kick-scope.mjs";
import { pageSignals } from "../guard/shop.mjs";

const SCAM = { verdict: "SCAM", review: "SCAM" };

test("高分強特徵：換群＋群組連結 → 發通知、可踢", () => {
  const text = "本群即將解散，請大家加入新群 https://line.me/ti/g2/abcdEFG";
  const g = outboundGate({ ...SCAM, score: 7, names: ["假群組公告"] }, { text });
  assert.equal(g.send, true); assert.equal(g.feature, KICK_FAKE_GROUP);
  assert.equal(kickScopeDecision({ chatId: "c1", text, names: ["假群組公告"], ...SCAM }).kick, true);
});
test("強特徵分數不足 6 一律拉到 6（假精品、色情 PDF、詐騙群組）", () => {
  const lux = outboundGate({ ...SCAM, score: 4, names: ["仿冒精品連結"] }, { text: "LV 1:1 高仿包 https://lv-bag.shop/a" });
  assert.equal(lux.send, true); assert.equal(lux.feature, KICK_FAKE_LUXURY); assert.equal(lux.score, 6);
  const pdf = outboundGate({ score: 4, names: [] }, { text: "", fileName: "外流私密.pdf", fileInvite: true });
  assert.equal(pdf.feature, KICK_FAKE_PORN_PDF); assert.equal(pdf.score, 6);
  const qr = outboundGate({ review: "SCAM", score: 0, names: [] }, { qrContent: "https://line.me/ti/g2/xyz" });
  assert.equal(qr.feature, KICK_SCAM_GROUP);
  assert.equal(effectiveScore({ score: 9 }, "x"), 9);
});
test("帶單 LINE@ 假老師、仿冒官方釣魚 → 發", () => {
  assert.equal(strongFeature({ names: ["帶單老師 LINE@／官方帳號引流"] }), STRONG_BANDAN);
  assert.equal(strongFeature({ names: ["仿物流網址＋實名認證／解凍"] }), STRONG_PHISHING);
  assert.equal(strongFeature({ names: ["多層子網域仿物流／超商品牌網址"], review: "SCAM" }), STRONG_PHISHING);
  assert.equal(strongFeature({ names: ["多層子網域仿物流／超商品牌網址"], review: "OK" }), undefined);
});
test("冒用管理員＋群組邀請 → 強特徵（換群類）", () => {
  assert.equal(strongFeature({ verdict: "IMPERSONATION_INVITE", names: ["冒用「小明」", "外部邀請／引流連結或 QR code"] }, { text: "https://line.me/ti/g2/aa" }), KICK_FAKE_GROUP);
});
test("低分正常網址／新聞／工具／分享 → 完全不發", () => {
  for (const [entry, text] of [
    [{ score: 0, names: [] }, "分享一篇新聞 https://www.cna.com.tw/news/a.aspx"],
    [{ score: 2, names: ["頁面：單頁訂購表單"], verdict: "SCAM_SHOP", review: "SCAM" }, "https://news.example.com/a/1"],
    [{ score: 1, names: ["網址"] }, "好用工具 https://github.com/mars-tw/x"],
    [{ score: 3, names: ["短網址"] }, "看這個 https://reurl.cc/abc"],
    [{ score: 5, names: ["投資帶單", "私下聯繫"] }, "有興趣私訊"],
  ]) assert.equal(outboundGate(entry, { text }).send, false, text);
});
test("沒有強特徵，規則分數再高也不發（只記日誌）", () => {
  const g = outboundGate({ score: 9, names: ["投資帶單", "假投資平台", "私下聯繫"], verdict: "SCAM", review: "SCAM" }, { text: "穩賺不賠 加我" });
  assert.equal(g.send, false); assert.equal(g.reason, "no-strong-feature");
});
test("對抗放行：官方交易所正常貼文、商家穩賺促銷不可單獨命中", () => {
  assert.equal(outboundGate({ score: 2, names: ["LINE 官方帳號連結"] }, { text: "Pionex 派網官方公告 https://lin.ee/pionex" }).send, false);
  assert.equal(outboundGate({ score: 3, names: [] }, { text: "週年慶穩賺回饋！全館買一送一 https://shop.example.com" }).send, false);
});
test("排除群、Hao 群（warnOnly）：強特徵可發通知但不踢", () => {
  const text = "請搬到新群 https://line.me/ti/g2/zz";
  for (const scope of [{ excludeChats: ["bear"] }, { warnOnly: new Set(["bear"]) }, { learnOnly: new Set(["bear"]) }])
    assert.equal(kickScopeDecision({ chatId: "bear", text, names: ["假群組公告"], ...SCAM, scope }).kick, false);
  assert.equal(outboundGate({ ...SCAM, names: ["假群組公告"] }, { text }).send, true);
});
test("對抗：假冒正常網站格式（og:type article）的詐騙仍 >=6", () => {
  const html = `<meta property="og:type" content="article"><a href="/">x</a>LV 一折 出清 1:1 立即訂購 貨到付款`;
  assert.ok(pageSignals(html).includes("頁面：貨到付款"));
  const g = outboundGate({ ...SCAM, score: 5, names: ["仿冒精品連結"] }, { text: "新聞：LV 1:1 一比一 https://news-lv.top/a" });
  assert.equal(g.send, true); assert.ok(g.score >= 6);
});
test("在提醒大家的訊息（引用詐騙）不算強特徵", () => {
  assert.equal(outboundGate({ ...SCAM, names: ["假群組公告"] }, { text: "小心詐騙！有人說要換新群 https://line.me/ti/g2/aa 不要加入" }).send, false);
});
test("總閘可關（outboundGate.enabled=false）", () => {
  assert.equal(outboundGate({ score: 0 }, {}, { enabled: false }).send, true);
});

// 15:12 補充：新總閘對抗＋回歸 2afb810（新聞頁≠一頁式）
import { scoreScamShop, isArticlePage } from "../guard/shop.mjs";
import { STRONG_SCAM_SHOP } from "../guard/strong-gate.mjs";
const nav = Array.from({ length: 20 }, (_, i) => `<a href="/p/${i}">項目${i}</a>`).join("");
const shopEntry = (text, host, html, review) => {
  const r = scoreScamShop({ text, links: [{ host }], page: pageSignals(html), review });
  return { verdict: "SCAM_SHOP", names: ["疑似一頁式詐騙購物網站"], score: r.score, signals: r.signals, review, level: r.level };
};
test("真詐騙一頁式（名牌低價＋貨到付款＋怪網域＋覆核 SCAM）→ 有效分數≥6 會抓", () => {
  const html = `<body><a href="/">首頁</a>LV 包 一折 出清 立即訂購 收件人 配送地址 貨到付款</body>`;
  const e = shopEntry("LV 包包一折出清 貨到付款 https://lv-outlet-888.top/a", "lv-outlet-888.top", html, "SCAM");
  const g = outboundGate(e, { text: "" });
  assert.equal(g.send, true); assert.equal(g.feature, STRONG_SCAM_SHOP); assert.ok(g.score >= 6);
});
test("對抗：假冒新聞文章頁外觀的一頁式詐騙（og:type article＋貨到付款）仍≥6", () => {
  const html = `<head><meta property="og:type" content="article"></head><body><a href="/">首頁</a>LV 一折 立即訂購 收件人 貨到付款</body>`;
  const e = shopEntry("新聞：LV 一折 貨到付款 https://news-lv-999.top/a", "news-lv-999.top", html, "SCAM");
  assert.equal(outboundGate(e, {}).send, true);
});
test("普通聊天不到標註", () => {
  for (const t of ["早安大家", "今天比特幣漲好多", "晚上吃什麼？", "這工具不錯 https://github.com/mars-tw/anti-scam-helper"])
    assert.equal(outboundGate({ score: 0, names: [] }, { text: t }).send, false, t);
});
test("回歸 2afb810：新聞文章頁 ≠ 一頁式，且總閘不發", () => {
  const news = `<html><head><meta property="og:type" content="article"><script type="application/ld+json">{"@type":"NewsArticle"}</script></head><body>${nav}<article>記者報導 訂閱電子報</article></body></html>`;
  assert.equal(isArticlePage(news), true);
  assert.deepEqual(pageSignals(news), []);
  const e = shopEntry("看這篇 https://news.example.com/a/1", "news.example.com", news, "OK");
  assert.equal(e.level, "none");
  assert.equal(outboundGate(e, {}).send, false);
});
test("正常多頁電商站（站內連結多、無貨到付款、無名牌低價）不到標註", () => {
  const html = `<body>${nav}加入購物車 結帳 會員中心 退換貨政策</body>`;
  const e = shopEntry("這家襪子好穿 https://www.example-shop.com.tw/item/1", "www.example-shop.com.tw", html, "OK");
  assert.equal(outboundGate(e, {}).send, false);
  const e2 = shopEntry("這家襪子好穿 https://www.example-shop.com.tw/item/1", "www.example-shop.com.tw", html, "SCAM");
  assert.equal(outboundGate(e2, {}).send, false, "覆核誤判 SCAM 但分數低、無強特徵 → 仍不發");
});
