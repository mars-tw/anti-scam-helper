// 一頁式詐騙購物站：網域特徵＋訊息文字＋（選用）安全抓頁面（不執行 JS、短逾時、限大小、拒絕內網）。
// 只輸出分數與訊號名稱，不記網址內容。
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// 大型正規電商：連結全部屬於這些網域就不判。
export const LEGIT_SHOPS = [
  "shopee.tw", "shopee.com", "shp.ee", "momoshop.com.tw", "momo.dm", "pchome.com.tw", "24h.pchome.com.tw", "coupang.com", "tw.coupang.com",
  "buy.yahoo.com", "tw.buy.yahoo.com", "tw.bid.yahoo.com", "yahoo.com", "books.com.tw", "amazon.com", "amazon.co.jp", "amzn.to", "amzn.asia",
  "rakuten.com.tw", "rakuten.co.jp", "rakuten.com", "etmall.com.tw", "friday.tw", "shopping.friday.tw", "ruten.com.tw", "pcstore.com.tw",
  "costco.com.tw", "carrefour.com.tw", "ikea.com", "uniqlo.com", "apple.com", "decathlon.tw", "nike.com", "adidas.com.tw", "taobao.com", "tmall.com",
  "aliexpress.com", "ebay.com", "zalora.com.tw", "pinkoi.com", "line.me", "shop.line.me", "gift.line.me",
  "ti.com", // 2026-10-20 德州儀器官網被誤判一頁式（成員分享開發板連結）
];
const ODD_TLD = /\.(shop|store|top|xyz|vip|club|online|site|buzz|icu|cyou|sbs|cfd|life|live|fun|mom|bond|best|today|sale|deals|boutique|fashion|bags|click|link|monster|rest|quest|work|win|bid|loan|cn|cc|ws|tk|ml|ga|cf|gq)$/i;
const URL_RE = /(https?:\/\/)?(?<![\w.@-])((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s，。）)」』]*)?/gi;
const LUXURY = /\bLV\b|louis\s*vuitton|gucci|chanel|香奈兒|hermes|hermès|愛馬仕|prada|dior|迪奧|coach|celine|ysl|聖羅蘭|burberry|巴寶莉|balenciaga|fendi|bottega|longchamp|michael\s*kors|rolex|勞力士|名牌|精品|專櫃|正品|名品/i;
const DISCOUNT = /快閃|清倉|出清|破盤|下殺|殺到|跳樓|虧本|一折|[1-3１-３]\s*折|骨折|低至|只要\s*\$?\s*\d{2,4}|NT\$?\s*\d{2,4}(?!\d)|\$\s*\d{2,4}(?!\d)|\d{2,4}\s*元(?!\d)|大招|特賣|福利(品|社)|最後\s*\d+\s*(個|件|組)|限時|倒數|搶購|工廠直/i;
const COD = /貨到付款|貨到付|到府付款|超商取貨付款|取貨付款|先收貨後付款|不滿意.{0,4}退/;
const ORDER_FORM = /立即(訂購|搶購|下單|購買)|填寫.{0,6}(訂單|資料)|收件人|配送地址|聯絡電話.{0,10}地址|訂購數量/;

export function isLegitShop(host) {
  const h = String(host ?? "").toLowerCase().replace(/^www\./, "");
  return LEGIT_SHOPS.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

/** 從（已清掉白名單連結的）文字抽出外部網址的 host 清單（去掉正規電商）。 */
export function shopLinks(text) {
  const out = [];
  for (const match of String(text ?? "").matchAll(URL_RE)) {
    const host = match[2].toLowerCase();
    if (!match[1] && !match[3]) continue; // 「abc.com」純網域字樣（沒有 http、沒有路徑）不算連結
    if (isLegitShop(host)) continue;
    out.push({ host, url: `${match[1] ? "" : "https://"}${match[0]}` });
  }
  return out;
}

/** 頁面 HTML（不執行 JS）的訊號。 */
export function pageSignals(html) {
  const text = String(html ?? "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const internal = (String(html ?? "").match(/<a\s[^>]*href=["'](\/|#|\.\/|[a-z]+\.html)[^"']*["']/gi) ?? []).length;
  const signals = [];
  if (COD.test(text)) signals.push("頁面：貨到付款");
  if (ORDER_FORM.test(text)) signals.push("頁面：單頁訂購表單");
  if (LUXURY.test(text) && DISCOUNT.test(text)) signals.push("頁面：名牌低價");
  if (internal <= 5 && ORDER_FORM.test(text)) signals.push("頁面：一頁式");
  return signals;
}

/**
 * 打分數。confident：強訊號（≥5 分，或 Meta 判 SCAM 且 ≥3 分）且 Meta 沒判 OK；unsure：≥2 分。
 * @returns {{ score:number, signals:string[], level:"confident"|"unsure"|"none" }}
 */
export function scoreScamShop({ text, links, page = [], review }) {
  if (!links?.length) return { score: 0, signals: [], level: "none" };
  const signals = [];
  let score = 0;
  const add = (points, name) => { score += points; signals.push(name); };
  const t = String(text ?? "");
  if (LUXURY.test(t) && DISCOUNT.test(t)) add(2, "名牌低價");
  else if (LUXURY.test(t) || /快閃店|大招/.test(t)) add(1, "名牌／快閃");
  if (COD.test(t)) add(2, "貨到付款");
  if (links.some((link) => ODD_TLD.test(link.host))) add(1, "可疑網域");
  if (links.some((link) => /\d{3,}|[a-z]{12,}|(-[a-z0-9]+){2,}/i.test(link.host.split(".")[0]))) add(1, "亂碼網域");
  for (const name of page) add(name === "頁面：名牌低價" ? 1 : 2, name);
  let level = "none";
  if (review !== "OK" && (score >= 5 || (review === "SCAM" && score >= 3))) level = "confident";
  else if (score >= 2) level = "unsure";
  return { score, signals, level };
}

function privateIp(ip) {
  if (isIP(ip) === 6) return /^(::1|::|fc|fd|fe80|::ffff:(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.))/i.test(ip);
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
}

/** 安全抓頁面：只 http(s)、拒絕內網、手動跟轉址（最多 3 次）、逾時、限大小、只收 HTML。失敗回 undefined。 */
export async function fetchPageSafe(url, { timeoutMs = 5000, maxBytes = 300_000, fetchImpl = fetch, resolve = lookup } = {}) {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed;
    try { parsed = new URL(target); } catch { return undefined; }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return undefined;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const ips = isIP(host) ? [host] : (await resolve(host, { all: true }).catch(() => [])).map((entry) => entry.address);
    if (ips.length === 0 || ips.some(privateIp)) return undefined;
    let response;
    try {
      response = await fetchImpl(parsed, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
    } catch { return undefined; }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { target = new URL(response.headers.get("location"), parsed).toString(); continue; }
    if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get("content-type") ?? "")) return undefined;
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const chunks = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      chunks.push(value); size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes).toString("utf8");
  }
  return undefined;
}

/** 違規紀錄：只存 成員 ID → 時間戳陣列，30 天過期。 */
export function pruneOffenses(map, now = Date.now(), ttlMs = 30 * 86_400_000) {
  for (const [id, times] of Object.entries(map)) {
    const kept = (Array.isArray(times) ? times : []).filter((t) => Number.isFinite(t) && now - t < ttlMs);
    if (kept.length) map[id] = kept; else delete map[id];
  }
  return map;
}

/** 訊息裡的網址全部是正規電商（至少一個）：一般「詐騙連結刪除」也不處理。 */
export function allLinksLegit(text) {
  const hosts = [...String(text ?? "").matchAll(URL_RE)].filter((m) => m[1] || m[3]).map((m) => m[2]);
  return hosts.length > 0 && hosts.every(isLegitShop);
}
