// 自動回覆／@回覆的發訊者排除：發訊者 ID 在機器人 ID 清單裡，一律不回，只寫 log。
// guard.mjs 只傳機器人 ID（protectedIds 中 note 標機器人／bot＋chat.community.botIds）；protectedIds 參數保留給需要整份名單的呼叫者。
// 只看 ID，不看暱稱或內容（避免詐騙者改成同名暱稱就讓守衛不理他，也避免冒名者被誤當成機器人）。
// 不影響偵測、通知、刪踢：只在 reply() 入口使用。
//
// 10/30 誤判 B：訊息含連結／邀請且規則分數>0，或發送者近幾分鐘剛被通知 → 跳過自動回覆（只收緊回覆）。

/** 訊息含網址或群組邀請（給回覆閘門用；不碰通知／踢人）。 */
const LINK_OR_INVITE_RE = /https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}\/|line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\//i;

export function hasLinkOrInviteText(text = "") {
  return LINK_OR_INVITE_RE.test(String(text ?? ""));
}

/**
 * 自動回覆前閘門（純函式）。
 * - 發送者剛被通知過 → 跳過
 * - 訊息含連結／邀請且規則分數 > 0 → 跳過
 * 只回 { skip, reason }；不影響通知／踢人。
 */
export function shouldSkipAutoReply({ text = "", score = 0, senderRecentlyNotified = false } = {}) {
  if (senderRecentlyNotified) return { skip: true, reason: "sender-recently-notified" };
  if (hasLinkOrInviteText(text) && Number(score) > 0) return { skip: true, reason: "link-or-invite-score" };
  return { skip: false, reason: undefined };
}

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
