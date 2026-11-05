// 已知短網址唯讀展開結果分類（維護者 10/22 F／G）。
// 展開後仍停在短網址服務＝unresolved（不可標成 normal）；真正落地非短網址才 rewrite。
// 不在這裡去掉「短網址」分數：計分仍依改寫後（或未改寫）的本文，照舊。
// 10/30：unresolved 列進日報用 jsonl（與 unrecognized-links 同性質，給 22:00 人工辨識）。

/**
 * @param {object} opts
 * @param {{invite?:boolean,url?:string,html?:string}|null|undefined} opts.expanded
 * @param {boolean} [opts.stillShortener] 展開後 URL 仍命中已知短網址服務
 * @param {boolean} [opts.shopping] 落地頁是購物頁
 * @returns {{result:string,rewrite:boolean,extraNames:string[],shopWarn:boolean}}
 */
export function shortUrlExpandOutcome({ expanded, stillShortener = false, shopping = false } = {}) {
  if (expanded == null) {
    return { result: "unreachable", rewrite: false, extraNames: [], shopWarn: false };
  }
  if (expanded.invite === true) {
    return { result: "invite", rewrite: false, extraNames: ["短網址導向群組邀請"], shopWarn: false };
  }
  // 仍停在短網址服務（中繼／攔截頁）：不是 normal，不改寫（本文仍含短網址 → 分數照舊）。
  if (stillShortener) {
    return { result: "unresolved", rewrite: false, extraNames: [], shopWarn: false };
  }
  if (shopping) {
    return { result: "shopping", rewrite: true, extraNames: [], shopWarn: true };
  }
  // 文章、教學、文件、影片、GitHub 等 → 換成展開後的網址再判斷（計分依改寫後本文）。
  return { result: "normal", rewrite: true, extraNames: [], shopWarn: false };
}

/**
 * unresolved 日報列：有結果才回 JSON 字串；其他 result 回 null。
 * 不含訊息本文；url 由呼叫端自行截短／去識別。
 */
export function unresolvedShortReportLine({
  at, chatId, messageId, notePostId, url, result = "unresolved",
} = {}) {
  if (result !== "unresolved") return null;
  const row = {
    at: at ?? new Date().toISOString(),
    kind: "unresolved-short",
    chatId,
    ...(messageId != null ? { messageId } : {}),
    ...(notePostId != null ? { notePostId } : {}),
    ...(url ? { url: String(url).slice(0, 200) } : {}),
  };
  return JSON.stringify(row);
}

// 11/5 誤判審查 4：短網址展開成功、落地判 normal → 不再加「疑似短網址」／「短網址」分數（6 分）。
// 落地是 LINE 群組邀請／官方帳號／加好友／QR、可疑網域（規則有分、怪 TLD、已知詐騙網域）、仍是短網址、展開失敗 → 照舊計分。
const LINE_LANDING = /(?:^|\/\/|\.)(?:line\.me|lin\.ee|liff\.line\.me|line\.naver\.jp)(?:[/:?#]|$)|\/(?:R\/)?ti\/[gp]\/|openchat|addfriend|\/qr(?:[/?#]|$)|qr[-_]?code/i;
const SUSPICIOUS_TLD = /\.(shop|store|top|xyz|vip|club|online|site|buzz|icu|cyou|sbs|cfd|life|live|fun|mom|bond|best|today|sale|deals|boutique|fashion|bags|click|link|monster|rest|quest|work|win|bid|loan|cn|cc|ws|tk|ml|ga|cf|gq|ru|su|kr)$/i;
export const SHORT_URL_RULE_NAMES = ["疑似短網址", "短網址"];

/**
 * @param {object} o
 * @param {string} [o.expandedUrl] 展開後落地網址（無＝展開失敗）
 * @param {boolean} [o.invite] 落地是群組邀請
 * @param {boolean} [o.lineOa] 落地是 LINE 官方帳號
 * @param {boolean} [o.stillShortener] 落地仍是短網址服務
 * @param {boolean} [o.shopping] 落地是購物頁（照舊判斷）
 * @param {number} [o.landingScore] 落地網址本身的規則分數（不含短網址規則）
 * @returns {boolean} true＝可以拿掉短網址分數（換成落地網址再判斷）
 */
export function shortUrlNormalLanding({ expandedUrl, invite = false, lineOa = false, stillShortener = false, shopping = false, landingScore = 0 } = {}) {
  if (!expandedUrl || invite || lineOa || stillShortener || shopping) return false;
  let host;
  try { const u = new URL(expandedUrl); if (!/^https?:$/.test(u.protocol)) return false; host = u.hostname; } catch { return false; }
  if (LINE_LANDING.test(expandedUrl)) return false;
  if (SUSPICIOUS_TLD.test(host)) return false;
  if (landingScore > 0) return false;
  return true;
}

/**
 * 疑似短網址展開後的落地分類（guard 內 if/else-if 鏈；invite 優先，不得再走知識／購物）。
 * @returns {{extraNames:string[],knowledgeLink:boolean,shopWarn:boolean}}
 */
export function classifySusExpandLanding({ invite = false, knowledge = false, shopping = false } = {}) {
  if (invite) return { extraNames: ["短網址導向群組邀請"], knowledgeLink: false, shopWarn: false };
  if (knowledge) return { extraNames: [], knowledgeLink: true, shopWarn: false };
  if (shopping) return { extraNames: [], knowledgeLink: false, shopWarn: true };
  return { extraNames: [], knowledgeLink: false, shopWarn: false };
}
