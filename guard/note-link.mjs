// 10/27：記事本短網址展開、一般連結評分門檻、啟動狀態行（純函式，方便測試）。

/**
 * 記事本短網址展開結果 → 額外規則名稱與記事本處置。
 * 展開只用於「評分與通知」：導向群組邀請 → 加「短網址導向群組邀請」分數；
 * 不論展開結果，記事本處置最多是 notify（不刪、不踢；踢人條件不變），只警告群也一樣。
 */
export function noteLinkOutcome({ expanded, action = "none" } = {}) {
  const extraNames = expanded?.invite ? ["短網址導向群組邀請"] : [];
  const capped = action === "delete" && extraNames.length ? "notify" : action;
  return { extraNames, action: capped, kick: false };
}

/** 維護者 10/26 23:01／23:02：一般連結的「可能詐騙」評分回覆只在評分 > 0 時貼；0 分、沒分數都不貼。 */
export function shouldPostLinkScore({ kind, score } = {}) {
  if (kind !== "link-score") return true;
  return Number.isFinite(score) && score > 0;
}

/** 守衛啟動狀態行：只印開關與數量，不印 ID、群名或任何金鑰。 */
export function startupStatusLine(config = {}) {
  const ks = config.kickScope ?? {};
  const on = (v) => (v ? "開" : "關");
  const exclude = Array.isArray(ks.excludeChats) ? ks.excludeChats.length : 0;
  return `守衛狀態：kickScope.allChats=${on(ks.allChats === true)}、excludeChats=${exclude} 個；fileScan=${on(config.fileScan?.enabled === true)}；unrecognizedLink=${on(config.unrecognizedLink?.enabled === true)}`;
}
