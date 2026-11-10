// 士軒 11/10 17:18：「文字短網址展開是詐騙群邀請也要刪文＋標注，不踢」。
// 純函式（不連網）：從短網址展開結果取出 LINE 群組／社群邀請網址，並決定要不要走 deleteOnly（刪文＋標注、不踢）。
// 「是不是本群自己的邀請」沿用 QR 的 qrOrigin（本群邀請碼比對＋invite:lookup 反查），這裡不另寫判斷。
import { GROUP_INVITE } from "./kick-scope.mjs";

export const TEXT_SHORT_INVITE = "文字短網址導向別群邀請";
const INVITE_IN_HTML = /(?:https?:\/\/)?(?:[\w-]+\.)*line\.me\/(?:R\/)?ti\/g2?\/[\w-]{4,100}|(?:https?:\/\/)?openchat\.line\.me\/[a-z]{2}(?:-[a-z]{2,4})?\/(?:cover|join)\/[\w-]{4,100}/gi;

/** 展開結果裡的邀請網址（落地網址本身＋頁面寫死的邀請，最多 5 個）。展開失敗或不是邀請 → []。 */
export function shortInviteUrls(expanded) {
  if (!expanded || expanded.invite !== true) return [];
  const out = [];
  const add = (u) => { const v = String(u ?? "").trim(); if (v && GROUP_INVITE.test(v) && !out.includes(v) && out.length < 5) out.push(/^https?:/i.test(v) ? v : `https://${v}`); };
  if (expanded.url && GROUP_INVITE.test(expanded.url)) add(expanded.url);
  const html = String(expanded.html ?? "").replace(/\\\//g, "/");
  for (const m of html.match(INVITE_IN_HTML) ?? []) add(m);
  return out;
}

/**
 * 是否改走 deleteOnly。只在下列全部成立才回 { act: true }：
 * 展開結果是群組／社群邀請（names 有「短網址導向群組邀請」且取得到邀請網址）、覆核 SCAM、
 * 不是受保護發文者、沒有任何一個邀請網址被判為本群自己的（origin=own）、不在 qr.allow 白名單前綴。
 * 其他情況回 { act: false, reason }，呼叫端維持原本流程（原本是只通知）。
 */
export function textShortInviteDecision({ names = [], review, inviteUrls = [], origins = [], protectedSender = false, allow = [] } = {}) {
  if (!(Array.isArray(names) && names.includes("短網址導向群組邀請"))) return { act: false, reason: "not-invite" };
  if (!inviteUrls.length) return { act: false, reason: "no-invite-url" };
  if (review !== "SCAM") return { act: false, reason: "review-not-scam" };
  if (protectedSender) return { act: false, reason: "protected-sender" };
  if (inviteUrls.some((u) => (allow ?? []).some((p) => p && u.startsWith(p)))) return { act: false, reason: "qr-allow" };
  if (origins.some((o) => o?.origin === "own")) return { act: false, reason: "own-invite" };
  return { act: true, reason: origins.some((o) => o?.origin === "other") ? "other" : "unknown" };
}
