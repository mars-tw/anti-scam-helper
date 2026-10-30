// 紅包白名單（依群開啟）：交易所／LINE Pay 官方紅包連結與紅包 QR 不當詐騙（不通知、不刪、不踢）。
// 只認「官方網域（本身或子網域）＋紅包路徑」；短網址、仿冒網域、夾帶加賴／私訊／要付錢的字眼一律走一般流程。
export const RED_PACKET_RULES = [
  // 派網：紅包頁 pionex.com/<語系>/red-packet…（也接受 redpacket / red_packet）
  { id: "pionex", host: "pionex.com", path: /red[-_]?packet|redpacket/i },
  // 幣安：紅包分享連結 s.binance.com/<碼>、app.binance.com/uni-qr/<碼>；官網紅包／Crypto Box 頁
  { id: "binance-short", host: "s.binance.com", path: /^\/[A-Za-z0-9]{4,}/ },
  { id: "binance-uniqr", host: "app.binance.com", path: /^\/uni-qr\// },
  { id: "binance", host: "binance.com", path: /red[-_]?packet|crypto[-_]?box|redpackets/i },
  // OKX、Bybit：官網紅包頁
  { id: "okx", host: "okx.com", path: /red[-_]?packet|redpacket/i },
  { id: "bybit", host: "bybit.com", path: /red[-_]?packet|redpacket|giveaway/i },
  // LINE Pay（台灣）
  { id: "linepay", host: "pay.line.me", path: /./ },
];

const URL_RE = /\bhttps?:\/\/[^\s<>"'）)】」]+|(?<![\w.@-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'）)】」]*/gi;
// 紅包詐騙常見的引流／要錢字眼：有這些就不算白名單紅包。
export const RED_PACKET_LURE = /加\s*(我\s*)?(賴|line)|line\s*id|私(訊|聊|我)|密我|加好友|頭像|匯款|轉帳|保證金|手續費|解凍|先(付|儲值|入金)|驗證碼|助記詞|私鑰|錢包.{0,4}(授權|連接|連結)|授權錢包|填寫.{0,6}(帳號|密碼)|輸入.{0,6}(帳號|密碼)/i;

function hostMatches(hostname, host) {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === host || h.endsWith(`.${host}`);
}

/** 一個網址是否為官方紅包連結；回傳規則 id 或 undefined。 */
export function redPacketRule(url, rules = RED_PACKET_RULES) {
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return undefined; }
  if (parsed.username || parsed.password) return undefined;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const path = `${parsed.pathname}${parsed.search}`;
  return rules.find((rule) => hostMatches(parsed.hostname, rule.host) && rule.path.test(path))?.id;
}

/**
 * 文字（或 QR 解碼內容）是否「只有」官方紅包連結：至少一個網址、全部是官方紅包、沒有引流字眼。
 * extraHosts：設定檔加的網域（同樣要求路徑含紅包字樣，除非寫成 { host, anyPath: true }）。
 */
export function isRedPacketOnly(text, { extra = [] } = {}) {
  const content = String(text ?? "");
  if (RED_PACKET_LURE.test(content.normalize("NFKC"))) return { ok: false, reason: "lure" };
  const urls = content.match(URL_RE) ?? [];
  if (!urls.length) return { ok: false, reason: "no-link" };
  const rules = [...RED_PACKET_RULES, ...extra.map((e) => (typeof e === "string" ? { id: `cfg:${e}`, host: e, path: /red[-_]?packet|redpacket|紅包/i } : { id: `cfg:${e.host}`, host: e.host, path: e.anyPath ? /./ : /red[-_]?packet|redpacket|紅包/i }))];
  const ids = [];
  for (const url of urls) {
    const id = redPacketRule(url.replace(/[.,，。!！]+$/, ""), rules);
    if (!id) return { ok: false, reason: "other-link" };
    ids.push(id);
  }
  return { ok: true, rules: [...new Set(ids)] };
}

/** 網域看起來像交易所，卻不是官方網域（pi0nex、binance-gift.xyz 這類）。 */
const BRAND = /(p[i1l]+[o0]n[e3]x|b[i1l]+n[a@4]nc[e3]|[o0]kx|byb[i1l]+t)/i;
const OFFICIAL = ["pionex.com", "pionexapp.com", "binance.com", "binance.info", "okx.com", "bybit.com"];
export function lookalikeExchange(text) {
  for (const url of String(text ?? "").match(URL_RE) ?? []) {
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      // Node 22 對無效 punycode（例如 xn--pionex-cka.com）丟 Invalid URL；改從字串抽主機，避免漏判仿冒。
      const raw = String(url).match(/^(?:https?:\/\/)?([^/?#\s]+)/i)?.[1] ?? "";
      host = raw.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "").replace(/:\d+$/, "");
      if (!host) continue;
    }
    if (BRAND.test(host) && !OFFICIAL.some((o) => hostMatches(host, o))) return true;
  }
  return false;
}

// ── 記事本連結白名單（依群）─────────────────────────────────────
// 群主／管理員／受保護成員在記事本貼的連結，是這個群自己的正式資源：同一個連結（主機＋路徑完全一樣，大小寫算）
// 在這個群再出現，不當詐騙。只比對完全相同的連結，換個短網址代碼就不算。
export function extractUrls(text) {
  return (String(text ?? "").match(URL_RE) ?? []).map((url) => url.replace(/[.,，。!！]+$/, ""));
}

// 少數網站的「哪一個內容」寫在查詢字串（YouTube 的 v、Drive 的 id）：這些參數留在鍵裡，避免白名單一條影片就放行整個網站。
const IDENTITY_QUERY = { "youtube.com": ["v"], "m.youtube.com": ["v"], "music.youtube.com": ["v"], "drive.google.com": ["id"] };

/** 連結鍵：去掉協定、www、查詢字串（IDENTITY_QUERY 例外）與結尾斜線；主機轉小寫，路徑保留大小寫（短網址代碼分大小寫）。 */
export function linkKey(url) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (parsed.username || parsed.password) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const keep = (IDENTITY_QUERY[host] ?? []).filter((name) => parsed.searchParams.get(name)).map((name) => `${name}=${parsed.searchParams.get(name)}`);
    return `${host}${parsed.pathname.replace(/\/+$/, "")}${keep.length ? `?${keep.join("&")}` : ""}`;
  } catch { return undefined; }
}

/** 訊息裡「全部」連結都在 known（linkKey 集合）裡、至少一個、沒有引流字眼。 */
export function allLinksKnown(text, known) {
  const content = String(text ?? "");
  if (!known?.size) return { ok: false, reason: "empty" };
  if (RED_PACKET_LURE.test(content.normalize("NFKC"))) return { ok: false, reason: "lure" };
  const urls = extractUrls(content);
  if (!urls.length) return { ok: false, reason: "no-link" };
  for (const url of urls) if (!known.has(linkKey(url))) return { ok: false, reason: "other-link" };
  return { ok: true, count: urls.length };
}
