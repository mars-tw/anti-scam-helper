// 已確認詐騙社群／群組邀請碼（士軒 11/5 18:21：短網址展開後是群邀請要當強特徵；色情引流社群邀請碼進特徵庫）。
// 邀請碼本身不進 git（本機 data/scam-patterns/scam-invites.json 或設定 scamInviteTickets）；這裡只提供比對函式。
// 純函式，方便測試。

export const KNOWN_SCAM_INVITE = "已知詐騙群組邀請";

// line.me/ti/g2/<碼>、R/ti/g2、<碼>；openchat.line.me/<區>/cover|join/<碼>
const TICKET_RE = /(?:line\.me\/(?:R\/)?ti\/g2\/|openchat\.line\.me\/[a-z]{2}(?:-[a-z]{2,4})?\/(?:cover|join)\/)([\w-]{4,100})/gi;

/** 從文字／網址／HTML 抽出社群邀請碼（去重，保留大小寫）。 */
export function inviteTicketsIn(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? "").matchAll(TICKET_RE)) {
    const t = m[1];
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** 正規化邀請碼集合（去空白；空的丟掉）。 */
export function normalizeInviteTickets(tickets = []) {
  return [...new Set((tickets ?? []).map((t) => String(t ?? "").trim()).filter((t) => t.length >= 4))];
}

/**
 * 文字裡有沒有命中已確認詐騙邀請碼。
 * @returns {string[]} 命中的邀請碼（可能多個）
 */
export function knownScamInviteHits(text, tickets = []) {
  const known = new Set(normalizeInviteTickets(tickets));
  if (!known.size) return [];
  return inviteTicketsIn(text).filter((t) => known.has(t));
}

/** 要不要加「已知詐騙群組邀請」這條名稱。 */
export function hasKnownScamInvite(text, tickets = []) {
  return knownScamInviteHits(text, tickets).length > 0;
}
