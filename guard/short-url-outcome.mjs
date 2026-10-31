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
