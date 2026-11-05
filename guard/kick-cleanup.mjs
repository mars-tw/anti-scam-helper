// 11/5 21:02：踢人成功後，把同一人在同群近 24 小時被守衛標過詐騙、仍在群的訊息一併刪除。
// 只刪守衛日誌裡有紀錄的 messageId（不看內容、不猜）；已刪過的不重刪。純函式，方便測試。
import { GROUP_INVITE } from "./kick-scope.mjs";
import { hasKnownScamInvite } from "./known-scam-invite.mjs";

// 「被守衛標過詐騙」的紀錄（含圖片 QR、vision 判詐騙、帶單）。一般連結只評分（link-score-only）不算。
export const CLEANUP_FLAG_ACTIONS = /^(flagged|suspect-flag|scam-link-flag|scam-link-delete-failed|vision-flag|qr-flag|qr-impersonation|impersonation-(flag|suspect)|scam-shop-(suspect|handled)|bandan-line-oa-(flag|kick|delete-failed)|repeat-flag|kick-suppressed|dry-run)$/;
const DELETED_ACTIONS = /(-deleted$|^removed$|^kick-cleanup-deleted$)/;

/**
 * @param {Array<object>} records 守衛日誌（已 parse）
 * @returns {string[]} 要刪的 messageId（舊到新，最多 limit 則）
 */
export function cleanupTargets(records, { chatId, senderId, exceptIds = [], now = Date.now(), windowMs = 24 * 3600_000, limit = 50 } = {}) {
  if (!chatId || !senderId) return [];
  const except = new Set(exceptIds.filter(Boolean));
  const flagged = new Map();
  const deleted = new Set();
  for (const r of records ?? []) {
    if (!r || r.chatId !== chatId || !r.messageId) continue;
    const at = Date.parse(r.at ?? "");
    if (!Number.isFinite(at) || at < now - windowMs || at > now + 60_000) continue;
    if (DELETED_ACTIONS.test(String(r.action ?? "")) && (r.messageDeleted !== false)) { deleted.add(r.messageId); continue; }
    if (r.senderId !== senderId) continue;
    if (CLEANUP_FLAG_ACTIONS.test(String(r.action ?? ""))) flagged.set(r.messageId, at);
  }
  return [...flagged.entries()].filter(([id]) => !except.has(id) && !deleted.has(id)).sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id);
}

/** 這個群／這個人可不可以做踢後清理（再擋一次）。 */
export function cleanupAllowed({ chatId, senderId, excludeChats = [], warnOnly = new Set(), learnOnly = new Set(), protectedSender = false } = {}) {
  if (!chatId || !senderId || protectedSender) return false;
  if ((excludeChats ?? []).includes(chatId) || warnOnly.has?.(chatId) || learnOnly.has?.(chatId)) return false;
  return true;
}

/** 圖片 QR 掃描結果分類（只給日誌 qrResult 用，不含內容）。 */
export function qrResultKind(content, { tickets = [], isLineInvite = () => false } = {}) {
  if (!content) return "none";
  const c = String(content);
  if (GROUP_INVITE.test(c)) return hasKnownScamInvite(c, tickets) ? "known-scam-invite" : "line-group-invite";
  if (isLineInvite(c)) return "line-friend-or-oa";
  if (/^https?:\/\//i.test(c)) return "url";
  return "other";
}

// 士軒 11/5 21:13：看圖「確定」詐騙（SCAM，不含 UNSURE／SCAM_WEAK）＋圖中文字有引流字眼，兩個都要成立。
export const VISION_LURE = "圖片判詐騙＋帶單／加 LINE／進群引流";
// 審查 11/5 21:49：只有「加 LINE／加群／進群」不算；必須同時有帶單／跟單／老師／獲利／投資一類字眼。
const LURE_INVEST = /帶單|跟單|喊單|老師|獲利|投資|穩賺|保證賺|翻倍|出金|飆股|明牌/;
const LURE_JOIN = /加\s*(?:LINE|line|Line|賴|好友)|加我|私訊|進群|入群|加群|拉群|加入.{0,6}群|群組連結|官方帳號|LINE@/;
// 交易所官方公告、活動宣傳、商家促銷：就算有字眼也不踢。
const BENIGN = /官方公告|系統公告|維護公告|上幣公告|官方活動|官方群組|活動(?:宣傳|海報|公告|辦法)|抽獎|促銷|特價|折扣|優惠券|週年慶|門市|店家|商家|菜單|營業時間/;
export function visionLureKick({ verdict, reason = "", protectedSender = false } = {}) {
  if (protectedSender || verdict !== "SCAM") return false;
  const r = String(reason ?? "");
  return LURE_INVEST.test(r) && LURE_JOIN.test(r) && !BENIGN.test(r);
}
