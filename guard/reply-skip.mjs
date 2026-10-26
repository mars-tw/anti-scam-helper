// 自動回覆／@回覆的發訊者排除：發訊者 ID 在機器人 ID 清單裡，一律不回，只寫 log。
// guard.mjs 只傳機器人 ID（protectedIds 中 note 標機器人／bot＋chat.community.botIds）；protectedIds 參數保留給需要整份名單的呼叫者。
// 只看 ID，不看暱稱或內容（避免詐騙者改成同名暱稱就讓守衛不理他，也避免冒名者被誤當成機器人）。
// 不影響偵測、通知、刪踢：只在 reply() 入口使用。

/** 從 config.protectedIds 取出所有 ID（字串或 { ids, id }）。 */
export function botIdsFromProtected(protectedIds = []) {
  return (protectedIds ?? []).filter((e) => e && typeof e === "object" && /機器人|bot/i.test(e.note ?? "")).flatMap((e) => [...(e.ids ?? []), ...(e.id ? [e.id] : [])]);
}

export function protectedIdList(protectedIds = []) {
  return (protectedIds ?? []).flatMap((entry) => (typeof entry === "string" ? [entry] : [...(entry?.ids ?? []), ...(entry?.id ? [entry.id] : [])]));
}

/** 建立判斷函式：senderId 在名單內回傳 true（不要回覆）。 */
export function makeReplySkip({ protectedIds = [], botIds = [] } = {}) {
  const ids = new Set([...protectedIdList(protectedIds), ...botIds].filter((id) => typeof id === "string" && id));
  return (senderId) => typeof senderId === "string" && ids.has(senderId);
}
