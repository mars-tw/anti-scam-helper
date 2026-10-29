// 已知短網址唯讀展開結果分類（維護者 10/22 F／G）。
// 展開後仍停在短網址服務＝unresolved（不可標成 normal）；真正落地非短網址才 rewrite、去掉「短網址」分數。

/**
 * @param {object} opts
 * @param {{invite?:boolean,url?:string,html?:string}|null|undefined} opts.expanded
 * @param {boolean} [opts.stillShortener] 展開後 URL 仍命中已知短網址服務
 * @param {boolean} [opts.shopping] 落地頁是購物頁
 * @returns {{result:string,rewrite:boolean,dropShortenerName:boolean,extraNames:string[],shopWarn:boolean}}
 */
export function shortUrlExpandOutcome({ expanded, stillShortener = false, shopping = false } = {}) {
  if (expanded == null) {
    return { result: "unreachable", rewrite: false, dropShortenerName: false, extraNames: [], shopWarn: false };
  }
  if (expanded.invite === true) {
    return { result: "invite", rewrite: false, dropShortenerName: false, extraNames: ["短網址導向群組邀請"], shopWarn: false };
  }
  // 仍停在短網址服務（中繼／攔截頁）：不是 normal，保留「短網址」計分，不改寫。
  if (stillShortener) {
    return { result: "unresolved", rewrite: false, dropShortenerName: false, extraNames: [], shopWarn: false };
  }
  if (shopping) {
    return { result: "shopping", rewrite: true, dropShortenerName: true, extraNames: [], shopWarn: true };
  }
  // 文章、教學、文件、影片、GitHub 等 → 換成展開後網址再判斷，並去掉「短網址」分數。
  return { result: "normal", rewrite: true, dropShortenerName: true, extraNames: [], shopWarn: false };
}

/**
 * 三種群（踢人／非踢人／Hao0321 只警告）在「展開成功為 normal」時，通知層是否應因去掉短網址分數而不再只靠短網址告警。
 * 不改變踢人條件；invite／unresolved 不走這條。
 */
export function shortUrlNormalShouldQuiet({ outcome, scoreAfterDrop, notifyScore = 3 } = {}) {
  if (!outcome || outcome.result !== "normal" || !outcome.dropShortenerName) return false;
  return Number(scoreAfterDrop) < Number(notifyScore);
}
