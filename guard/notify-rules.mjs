const INVITE_RE = /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\/|line\.me\/(?:R\/)?square\//i;
export const CROSS_INVITE = "同群組邀請跨群出現";
/** 踢人群（per-chat kickMode:kick，維護者 10/22 15:51）可刪踢的通知層理由；其他群一律只通知。 */
export const MINER_KICKABLE = new Set([CROSS_INVITE, "冒充負責人問帳戶／指定匯款", "同群多個帳號頭像相同", "同群多個帳號暱稱相同且像真管理員"]);
/** 踢人群刪踢判斷：沿用 decideChatKick 規則（Claude 判 SCAM；覆核 SCAM／空／逾時→踢；OK／UNSURE→通知；非 Claude→通知）。 */
export function minerAction({ perChatKick, reasons = [], verdict, model, review, protectedMember }) {
  if (!perChatKick || protectedMember || !reasons.some((r) => MINER_KICKABLE.has(r))) return "notice";
  if (verdict !== "SCAM" || !/^claude/i.test(String(model ?? ""))) return "notice";
  return review === "SCAM" || review === undefined || review === "UNAVAILABLE" || review === "TIMEOUT" ? "kick" : "notice";
}
// 通知層（10/22 誤判審查／情資分析）：只決定「要不要通知管理員」，分數只算通知分，絕不計入踢人分數，也不刪文。
import { createHash } from "node:crypto";
import { MAINSTREAM_CONTENT_DOMAINS, PLATFORM_SHORTENERS } from "./rules.mjs";

const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
const INVEST = /投資|帶單|跟單|老師|獲利|報酬|收益|配息|股票|虛擬貨幣|幣圈|合約|USDT|期貨|黃金/i;

/** 通知分規則（e／f／g）。f 直接通知；e、g 各 +2，e 跟投資字眼一起再 +2。 */
export const NOTIFY_RULES = [
  { name: "福利／簽到／贈品／合資話術", score: 2, investBonus: 2, pattern: /福利群|每日簽到|免費(?:贈品|送|領).{0,12}(?:加|line|LINE|賴)|合資|每月配息|月月配息|黃金(?:交付|交割)|繳(?:稅金|保證金).{0,8}(?:領回|出金|提領)/ },
  { name: "冒充負責人問帳戶／指定匯款", score: 4, direct: true, pattern: /(?:帳戶|戶頭).{0,6}餘額|匯(?:款|錢)?到.{0,6}(?:指定|這個|以下).{0,4}(?:帳戶|帳號)|指定帳戶|匯款單.{0,6}(?:拍照|拍給|截圖)|(?:拍|傳).{0,4}匯款單/ },
  { name: "+1／抓圖／先付運費話術", score: 2, pattern: /[+＋]\s*1.{0,10}(?:加我|私訊|line|LINE|賴)|抓圖給我|先付運費|運費先付/ },
];

export function notifyScore(text) {
  const t = String(text ?? "");
  let score = 0; const names = []; let direct = false;
  for (const rule of NOTIFY_RULES) {
    if (!rule.pattern.test(t)) continue;
    score += rule.score; names.push(rule.name);
    if (rule.investBonus && INVEST.test(t)) { score += rule.investBonus; names.push("話術＋投資字眼"); }
    if (rule.direct) direct = true;
  }
  return { score, names, notify: direct || score >= 2 };
}

const KNOWLEDGE = /(?:^|\.)(?:github\.com|gitlab\.com|youtube\.com|youtu\.be|medium\.com|wikipedia\.org|notion\.site|docs\.[a-z0-9-]+\.[a-z]+|readthedocs\.io|stackoverflow\.com|arxiv\.org|hackmd\.io|vocus\.cc|substack\.com|dev\.to|npmjs\.com|huggingface\.co)$/i;
const SHOP_HOST = /(?:^|\.)(?:shopee\.|momoshop\.|pchome\.|ruten\.|amazon\.|taobao\.|tmall\.|shopline\.|cyberbiz\.|91app\.|easystore\.)|shop|store|mall/i;
/** 網址類型：短網址／知識／購物／群組邀請／其他。 */
export function urlKind(url, { shorteners = [], shopping = false } = {}) {
  const u = String(url ?? "");
  if (/line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\//i.test(u)) return "群組邀請";
  const host = (u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase();
  if (shorteners.some((d) => host === d || host.endsWith(`.${d}`))) return "短網址";
  if (KNOWLEDGE.test(host)) return "知識";
  if (shopping || SHOP_HOST.test(host)) return "購物";
  return "其他";
}
export const firstUrl = (text) => String(text ?? "").match(URL_RE)?.[0];
export const isKnowledgeUrl = (url) => urlKind(url) === "知識";

/** 圖片通知（a／c／b 的單張判斷、1 的 UNSURE 例外）。回 { notify, names, profitOnly, loss }。 */
export function imageNotify(verdict, reason) {
  const r = String(reason ?? "");
  const hasUrl = /網址|網站|水印|浮水印|\.com|\.net|\.io|\.cc|連結|URL/i.test(r) && !/無(?:LINE|引流|網址|連結)|沒有(?:網址|連結)/i.test(r.replace(/無QR(?:碼|code)?/gi, ""));
  const hasQr = /QR/i.test(r) && !/無\s*QR|沒有\s*QR/i.test(r);
  const names = [];
  if (verdict === "SCAM") names.push("圖片判詐騙");
  if (/老師|直播|帶單|帶大家|跟單/.test(r) && hasUrl) names.push("老師直播／帶單獲利圖＋網址水印");
  const apy = Math.max(0, ...[...r.matchAll(/(?:年化|APY|APR)[^0-9+]{0,6}\+?([0-9][0-9,]*)\s*%/gi)].map((m) => Number(m[1].replace(/,/g, ""))));
  if ((apy >= 500 || /秒合約|猜漲跌|賭(?:價格|漲跌)/.test(r)) && (hasQr || hasUrl)) names.push("高年化／秒合約＋QR或網址");
  if (verdict === "UNSURE" && /多個.{0,6}(?:同頭像|同暱稱|帳號).{0,10}(?:冒充|假冒).{0,4}管理|冒充管理/.test(r)) names.push("多帳號冒充管理員");
  const loss = /虧損|賠|負報酬|-\d/.test(r) && !/獲利|盈利|\+\d/.test(r);
  const profitOnly = !names.length && !loss && /獲利|盈利|收益|報酬|\+[0-9]/.test(r);
  return { notify: names.length > 0, names, profitOnly, loss };
}

/** 依發訊者／內容雜湊的 24h 狀態（b、3 的 SCAM≥2、跨群同內容）。只在記憶體，不存檔。 */
export function makeNotifyTracker({ windowMs = 24 * 3_600_000, max = 5000 } = {}) {
  const profit = new Map(); // chat sender → [time]
  const scams = new Map();  // sender → [time]
  const hashes = new Map(); // hash → Map(chatId → time)
  const prune = (list, now) => list.filter((t) => now - t < windowMs);
  const cap = (map) => { if (map.size > max) map.delete(map.keys().next().value); };
  return {
    /** 純獲利截圖：回 true＝同一人 24h 內第 2 次以上。 */
    profitImage(chatId, senderId, now = Date.now()) {
      const key = `${chatId} ${senderId}`; const list = [...prune(profit.get(key) ?? [], now), now];
      profit.set(key, list); cap(profit); return list.length >= 2;
    },
    /** 最近 24h 貼過獲利截圖，現在接著貼網址或叫人私訊。 */
    followsProfit(chatId, senderId, text, now = Date.now()) {
      const list = prune(profit.get(`${chatId} ${senderId}`) ?? [], now);
      return list.length > 0 && (Boolean(firstUrl(text)) || /私訊|私聊|密我|加我|加賴|加line/i.test(String(text ?? "")));
    },
    /** 記一次 SCAM 判定：回 true＝同一發訊者 24h 內 ≥2 次。 */
    scam(senderId, now = Date.now()) {
      const list = [...prune(scams.get(senderId) ?? [], now), now];
      scams.set(senderId, list); cap(scams); return list.length >= 2;
    },
    /** 同內容雜湊跨群：回出現的群數。 */
    crossChat(text, chatId, now = Date.now()) {
      const norm = String(text ?? "").normalize("NFKC").replace(/\s+/g, "");
      if (norm.length < 8) return 1;
      const h = createHash("sha256").update(norm).digest("hex").slice(0, 16);
      const seen = hashes.get(h) ?? new Map();
      for (const [c, t] of seen) if (now - t >= windowMs) seen.delete(c);
      seen.set(chatId, now); hashes.set(h, seen); cap(hashes);
      return seen.size;
    },
  };
}

/** 文字訊息的通知層判斷（呼叫端只在原本沒有處置時呼叫）。回 names（空陣列＝不通知）。 */
export function textNotifyReasons({ text, chatId, senderId, result, tracker, shorteners = [], inviteExpanded = false, log }) {
  const names = [];
  const ns = notifyScore(text);
  if (ns.notify) names.push(...ns.names);
  if ((result.names ?? []).includes("投資帶單") && result.verdict && !["OK", "SKIP", "MODEL_UNAVAILABLE", "OFFICIAL_LINK"].includes(result.verdict)) names.push("投資帶單＋第一層非 OK");
  if (result.verdict === "SCAM" && tracker.scam(senderId)) names.push("同一人 24 小時內第 2 次判詐騙");
  // 跨群同內容：只有含群組邀請（line.me/ti/g、ti/g2、社群邀請、或短網址展開後是群組邀請）才算（維護者 10/22 15:51 修正）。
  // 一般網址跨群重複可能只是推廣：不因「跨群」單獨通知，只回 crossChatPlain 給呼叫端記錄。
  const hasInvite = inviteExpanded || INVITE_RE.test(String(text ?? ""));
  const chats = (hasInvite || firstUrl(text)) ? tracker.crossChat(text, chatId) : 1;
  if (hasInvite && chats >= 2) names.push(CROSS_INVITE);
  else if (chats >= 2 && log) log({ crossChatPlain: chats });
  // h：帶子網域的短網址寫法（例如 xx.supr.link）：只通知（踢人規則不變）。
  for (const u of String(text ?? "").match(URL_RE) ?? []) {
    const host = (u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase();
    if (shorteners.some((d) => host.endsWith(`.${d}`) && host !== `www.${d}`)) { names.push("子網域短網址"); break; }
  }
  if (tracker.followsProfit(chatId, senderId, text)) names.push("獲利截圖後接著貼網址／叫人私訊");
  // 10/22 20:51 誤判後：0 分只靠模型判詐不通知；要有確定特徵（群組邀請、未知短網址、已知詐騙網域）才通知。
  if (result.zeroScoreScamReviewed && zeroScoreShouldNotify(result.names)) names.push("0 分但第一層與雲端覆核都判詐騙");
  return [...new Set(names)];
}

/** d：同群 ≥2 個非管理員帳號頭像相同，或暱稱 NFKC 相同且像真管理員。 */
export function makeLookalikeTracker({ max = 5000 } = {}) {
  const byAvatar = new Map(); // chat avatarKey → Set(sender)
  const byName = new Map();   // chat nfkcName → Set(sender)
  const norm = (n) => String(n ?? "").normalize("NFKC").replace(/[\s\u200B-\u200F\u2060\uFEFF]/g, "").toLowerCase();
  const add = (map, key, id) => { const s = map.get(key) ?? new Set(); s.add(id); map.set(key, s); if (map.size > max) map.delete(map.keys().next().value); return s.size; };
  return {
    norm,
    /** adminNames：這群真管理員暱稱（NFKC 後）。回觸發的理由。 */
    see({ chatId, senderId, avatarKey, senderName, adminNames = [] }) {
      const names = [];
      if (avatarKey && add(byAvatar, `${chatId} ${avatarKey}`, senderId) >= 2) names.push("同群多個帳號頭像相同");
      const n = norm(senderName);
      if (n && add(byName, `${chatId} ${n}`, senderId) >= 2 && adminNames.map(norm).some((a) => a && (a === n || n.includes(a) || a.includes(n)))) names.push("同群多個帳號暱稱相同且像真管理員");
      return names;
    },
  };
}

// ── 仿冒群主／管理員（踢人群直接刪踢，維護者 10/22 15:53）────────────
const HOMOGLYPH = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ⅼ": "l", "Ӏ": "l", "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t", "κ": "k", "ι": "i", "Ꭺ": "a" };
const INVIS = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/gu;
const CROWN = /[👑♔♕♚♛🤴👸]/u;
/** NFKC＋去零寬／特殊符號／同形字。 */
export function canonName(raw) {
  return [...String(raw ?? "").normalize("NFKC").replace(INVIS, "").toLowerCase()].map((c) => HOMOGLYPH[c] ?? c).join("").replace(/[^\p{L}\p{N}]/gu, "");
}
function nearlySame(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] <= 1;
}
/** 回 { kick, signals, victim }。只有暱稱仿冒＋（同頭像 ID／皇冠符號／特殊符號偽裝）才 kick；頭像模型判皇冠不在這裡用。 */
export function impersonatorKick({ perChatKick, protectedMember, senderName, avatarKey, admins = [] }) {
  if (!perChatKick || protectedMember) return { kick: false, signals: [] };
  const me = canonName(senderName);
  if (me.length < 2) return { kick: false, signals: [] };
  for (const admin of admins) {
    const target = canonName(admin?.name);
    if (!nearlySame(me, target)) continue;
    const signals = [];
    if (avatarKey && admin.avatarKey && avatarKey === admin.avatarKey) signals.push("頭像 ID 與真管理員相同");
    if (CROWN.test(String(senderName)) && !CROWN.test(String(admin.name ?? ""))) signals.push("暱稱含皇冠符號");
    const raw = String(senderName ?? "").normalize("NFKC");
    const disguised = new RegExp(INVIS.source, "u").test(String(senderName ?? "")) || [...raw.toLowerCase()].some((c) => HOMOGLYPH[c]) || (raw.replace(/[\p{L}\p{N}\s]/gu, "").replace(CROWN, "") !== String(admin.name ?? "").normalize("NFKC").replace(/[\p{L}\p{N}\s]/gu, "") && raw !== String(admin.name ?? "").normalize("NFKC"));
    if (disguised) signals.push("特殊符號偽裝暱稱");
    if (signals.length) return { kick: true, signals, victim: admin.name };
  }
  return { kick: false, signals: [] };
}

// ── 16:31 誤判修正：知識／社群網站放行、只有覆核判 SCAM 不通知 ─────────────
const KNOWLEDGE_PAGE = /<title[^>]*>[^<]{0,200}(?:社群|社區|community|技術|開源|open\s*source|docs?|documentation|文件|教學|tutorial|conference|研討會|年會|meetup|聚會|開發者|developer|blog|部落格|wiki)[^<]{0,200}<\/title>|<meta[^>]+(?:og:type"[^>]+content="(?:article|website)"[^>]*>[\s\S]{0,400}(?:社群|community|技術|開源|docs|教學)|name="description"[^>]+content="[^"]{0,300}(?:社群|社區|community|技術|開源|open source|開發者|developer|教學|文件))/i;
const SHOP_PAGE = /加入購物車|立即購買|add to cart|buy now|結帳|checkout|信用卡/i;
/** 展開／抓到的頁面是不是知識／社群／技術文件（購物頁不算）。 */
export function isKnowledgePage(url, html = "") {
  if (SHOP_PAGE.test(String(html))) return false;
  return urlKind(url) === "知識" || KNOWLEDGE_PAGE.test(String(html).slice(0, 20000));
}
/** 確定特徵：有這些就不因「只有覆核判 SCAM」而降級。 */
export const CERTAIN_FEATURES = new Set(["群組邀請連結", "短網址導向群組邀請", "疑似短網址", "短網址", "已知詐騙網域", "催促加入新群", "假群組公告", "假群組連結"]);
/** 第一層 Claude 判 OK、只有覆核判 SCAM、沒有確定特徵 → true＝只記錄不通知不標記。 */
export function reviewOnlyScam({ verdict, model, review, names = [] }) {
  return verdict === "OK" && /^claude/i.test(String(model ?? "")) && review === "SCAM" && !names.some((n) => CERTAIN_FEATURES.has(n));
}

// ── 主流影音／社群網址：本身不能當詐騙依據 ─────────────────────────────
export const MAINSTREAM_MEDIA_DOMAINS = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "vimeo.com", "bilibili.com", "b23.tv", "twitch.tv", "tiktok.com", "instagram.com", "facebook.com", "fb.watch", "threads.net", "threads.com", "x.com", "twitter.com", "reddit.com", "podcasts.apple.com", "open.spotify.com",
  // 主流交易所與看盤工具：網址本身不是詐騙依據（邀請碼、帶單、私訊等仍由規則計分）。
  "tradingview.com", "pionex.com", "binance.com", "okx.com", "bybit.com", "bitget.com", "coinmarketcap.com", "coingecko.com", "max.maicoin.com", "bitopro.com", "investing.com", "cnyes.com"];
// 加上平台官方短網址與主流內容網站（新聞、論壇、電商、交易所）。帶路徑的項目（goo.gl/maps）只比主機。
const ALL_MEDIA = [...new Set([...MAINSTREAM_MEDIA_DOMAINS, ...MAINSTREAM_CONTENT_DOMAINS, ...PLATFORM_SHORTENERS.filter((d) => !d.includes("/"))])];
const MEDIA_HOST = (host) => ALL_MEDIA.some((d) => host === d || host.endsWith(`.${d}`));
/** 主機名稱是主流影音／社群網站（含子網域，例如 m.youtube.com）。仿冒網域（youtube.com.evil.xyz、fakeyoutube.com）不算。 */
export function isMainstreamMediaHost(host) {
  return MEDIA_HOST(String(host ?? "").toLowerCase().replace(/^www\./, ""));
}
/** 訊息裡有網址，而且全部都是主流影音／社群網址。 */
export function onlyMainstreamMediaLinks(text) {
  const hosts = (String(text ?? "").match(URL_RE) ?? []).map((u) => (u.replace(/^https?:\/\//i, "").split(/[/?#:]/)[0] || "").toLowerCase());
  return hosts.length > 0 && hosts.every(isMainstreamMediaHost);
}
/** 規則 0 分、模型判詐：只有帶確定特徵時才通知，否則只記錄。 */
export function zeroScoreShouldNotify(names = []) {
  return (names ?? []).some((n) => CERTAIN_FEATURES.has(n));
}
