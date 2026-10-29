// 冒名＋群組邀請：判斷前先展開短網址（維護者 10/29「冒名貼群邀請要踢，先展開短網址」）。
// 純函式，方便測試。展開失敗不可當邀請直接踢，交給「無法辨識連結」流程。

const GROUP_INVITE_RE = /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\/|line\.me\/ti\/g2\//i;

/** 短網址展開結果 → 冒名路徑要不要當成群組邀請。 */
export function inviteExpandOutcome(expanded) {
  if (expanded == null) return { inviteExpanded: false, expandFailed: true };
  if (expanded.invite === true) return { inviteExpanded: true, expandFailed: false, expandedUrl: expanded.url };
  return { inviteExpanded: false, expandFailed: false, expandedUrl: expanded.url };
}

/**
 * 從訊息文字找已知短網址（或可選的疑似短網址），唯讀展開後回傳是否導向群組邀請。
 * @param {string} text
 * @param {object} opts
 * @param {RegExp} opts.shortUrlRe 已知短網址服務
 * @param {RegExp} [opts.suspectRe] 疑似短網址（可選）
 * @param {(url:string)=>Promise<{invite?:boolean,url?:string}|undefined>} opts.expand
 * @param {boolean} [opts.enabled=true]
 */
export async function probeInviteShortUrl(text, { shortUrlRe, suspectRe, expand, enabled = true } = {}) {
  if (!enabled || typeof expand !== "function") return { inviteExpanded: false, expandFailed: false };
  const clean = String(text ?? "");
  const shortUrl = shortUrlRe ? clean.match(shortUrlRe)?.[0] : undefined;
  const suspect = !shortUrl && suspectRe ? clean.match(suspectRe)?.[0]?.trim() : undefined;
  const raw = shortUrl || suspect;
  if (!raw) return { inviteExpanded: false, expandFailed: false };
  const url = /^https?:/i.test(raw) ? raw : `https://${raw}`;
  const expanded = await expand(url).catch(() => undefined);
  return { ...inviteExpandOutcome(expanded), shortUrl: raw };
}

/**
 * 冒名＋邀請處置時：要不要當成「群組邀請／QR」這一類（可踢／可刪）。
 * 直接群邀請／QR／展開成功優先；展開失敗且沒有其他群邀請訊號 → 不當成群組邀請（不可直接踢）。
 */
export function impersonationInviteIsGroupy({ text = "", qrContent, inviteExpanded = false, expandFailed = false } = {}) {
  if (inviteExpanded) return true;
  if (qrContent) return true;
  if (GROUP_INVITE_RE.test(String(text ?? ""))) return true;
  if (expandFailed) return false;
  return false;
}

/**
 * 冒名路徑要不要先跳過、把展開失敗的短網址交給「無法辨識連結」流程。
 * 有直接群邀請、QR、或假群組公告時不跳過。
 */
export function shouldDeferImpersonationForExpandFail({ expandFailed = false, text = "", qrContent, fakeNotice = false } = {}) {
  if (!expandFailed) return false;
  if (qrContent) return false;
  if (fakeNotice) return false;
  if (GROUP_INVITE_RE.test(String(text ?? ""))) return false;
  return true;
}
