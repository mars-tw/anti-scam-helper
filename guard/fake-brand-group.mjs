// 士軒 11/10 08:51：假旅行社群／假超商群邀請的辨識（純函式，不連網）。
export const FAKE_TRAVEL_GROUP = "假旅行社群組邀請";
export const FAKE_STORE_GROUP = "假超商群組邀請";

const INVITE_LINK = /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\//i;
const TRAVEL_WORDS = /旅行社|旅遊|旅行團|機票|航空公司|訂房|住宿券/;
const STORE_WORDS = /超商|便利商店|7-?11|7-?eleven|小七|全家便利|全家會員|萊爾富|ok超商|ok mart/i;
const GROUP_WORDS = /群|社群|群組|openchat/i;

/** 回傳 FAKE_TRAVEL_GROUP／FAKE_STORE_GROUP，或 undefined（不是假品牌群組邀請）。 */
export function fakeBrandGroupInvite({ text = "", names = [], inviteExpanded = false, qrInvite = false } = {}) {
  const raw = String(text ?? "");
  const list = Array.isArray(names) ? names : [];
  const invite = qrInvite || inviteExpanded || list.includes("群組邀請連結") || list.includes("短網址導向群組邀請") || INVITE_LINK.test(raw);
  if (!invite) return undefined;
  const norm = raw.normalize("NFKC").replace(/\s+/g, "");
  // 群組字眼或邀請連結至少要有一個
  if (!(GROUP_WORDS.test(norm) || INVITE_LINK.test(raw))) return undefined;
  // 旅行社優先
  if (TRAVEL_WORDS.test(norm)) return FAKE_TRAVEL_GROUP;
  if (STORE_WORDS.test(norm)) return FAKE_STORE_GROUP;
  return undefined;
}
