// 受保護名字（暱稱）：config.protectedNames，只放主機本地 guard.config.json，不進 git。
// 暱稱去頭尾空白、NFKC、不分大小寫後完全相同 → 永遠不踢、不刪文（仍可照常通知）。只會讓守衛更保守。
export const GUARDED_FRAMES = new Set(["member:remove", "message:delete", "message:unsend"]);
export function normalizeProtectedName(name) {
  return typeof name === "string" ? name.normalize("NFKC").trim().toLowerCase() : "";
}
export function makeNameGuard(names = [], { maxIds = 20_000 } = {}) {
  const keys = new Set((Array.isArray(names) ? names : []).map(normalizeProtectedName).filter(Boolean));
  const byMessage = new Map(); // messageId → 是否受保護
  const isProtectedName = (name) => keys.size > 0 && keys.has(normalizeProtectedName(name));
  const protects = (message) => Boolean(message) && isProtectedName(message.senderName);
  function note(message) {
    if (!message?.messageId || !protects(message)) return;
    byMessage.set(message.messageId, true);
    if (byMessage.size > maxIds) byMessage.delete(byMessage.keys().next().value);
  }
  /** 送出前最後一道：踢人／刪文請求所指的訊息是受保護名字發的 → 擋下。 */
  const blocks = (frame) => Boolean(frame) && GUARDED_FRAMES.has(frame.type) && byMessage.has(frame.messageId);
  return { isProtectedName, protects, note, blocks, size: keys.size };
}
