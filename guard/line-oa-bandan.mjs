// 士軒 11/4 20:26：詐騙「帶單老師」LINE@／官方帳號引流。
// 辨識：LINE@ 形式（@ID、lin.ee、page.line.me、line.me/R/ti/p/@、官方帳號分享卡／截圖）＋帶單／跟單／老師／賺錢語意。
// 處置：永不踢；刪文看設定（預設開，非 Hao0321／只警告／只學習群）；Hao0321 三群只警告。
// 刪文超出現行 10/26「一般連結只評分」：獨立開關 bandanLineOa.deleteMessage，預設 true。
// 取得到公開頁認證／好友數就補強紀錄；取不到仍依帶單語意判定。

import { fetchPageSafe } from "./shop.mjs";

export const BANDAN_LINE_OA = "帶單老師 LINE@／官方帳號引流";

const NFKC = (s) => String(s ?? "").normalize("NFKC");

/** LINE 官方帳號／OA 連結形式。 */
export const LINE_OA_URL = /(?:https?:\/\/)?(?:lin\.ee\/[A-Za-z0-9_-]+|page\.line\.me\/[^\s<>"'）)】]+|line\.me\/(?:R\/)?ti\/p\/@[A-Za-z0-9._-]+)/i;

/** 加 LINE@／官方帳號分享卡用語。 */
export const LINE_OA_SHARE = /LINE\s*官方帳號|官方帳號(?:分享|卡片|QR|二維)?|加入官方帳號|加\s*LINE\s*@|掃描.{0,6}官方|官方\s*QR/i;

/** 帶上下文的 @帳號（避免一般 @提及誤中）。 */
export const LINE_OA_AT = /(?:加|賴|line\s*id|LINE\s*ID|官方(?:帳號)?|老師|帳號|好友)\s*[:：]?\s*@([a-z0-9][\w.-]{2,30})\b/i;

/** 帶單／跟單／老師賺錢語意（需與 OA 形式同現）。 */
export const BANDAN_LURE = /帶單|跟單|喊單|老師帶|投顧老師|操盤老師|帶你賺|保證獲利|穩賺|翻倍|報牌|明牌|招收學員|學員名額|進群帶|免費諮詢.{0,8}(?:帶|跟|賺)|分析師.{0,8}(?:一對一|帶|跟)|老師.{0,10}(?:帶單|跟單|獲利|賺錢|加)|(?:賺錢|獲利).{0,10}(?:老師|帶單|跟單)|跟單老師|帶單老師/i;

const ANTI_WARN = /(?:疑似|可能是?|小心|注意|提醒|警告|防範|謹防).{0,10}(?:詐騙|假)|是詐騙嗎|是不是詐騙|165/i;

/** 這段文字／QR 是否指向 LINE 官方帳號（含 OA 加好友連結）。 */
export function hasLineOaForm(text = "", { qrContent } = {}) {
  const raw = `${NFKC(text)}\n${NFKC(qrContent)}`;
  if (LINE_OA_URL.test(raw)) return true;
  if (qrContent && /line\.me\/(?:R\/)?ti\/p\/@|lin\.ee\/|page\.line\.me/i.test(String(qrContent))) return true;
  if (LINE_OA_AT.test(raw)) return true;
  if (LINE_OA_SHARE.test(raw) && /@[a-z0-9]/i.test(raw)) return true;
  return false;
}

export function hasBandanLure(text = "") {
  return BANDAN_LURE.test(NFKC(text));
}

/**
 * 帶單老師 LINE@：要同時有「帶單語意」與「LINE OA 形式」。
 * contextText：同人前後短時間內的帶單文／看圖理由（給 QR 接續用）。
 */
export function isBandanLineOa(text = "", { qrContent, contextText = "", protectedSender = false } = {}) {
  if (protectedSender) return false;
  const t = NFKC(text);
  const ctx = NFKC(contextText);
  const all = `${t}\n${ctx}\n${NFKC(qrContent)}`;
  // 純防詐提醒、沒有自己的帶單引流字眼 → 不算
  if (ANTI_WARN.test(t) && !hasBandanLure(t) && !hasBandanLure(ctx)) return false;
  if (!hasBandanLure(all)) return false;
  // OA 可在本則、QR 或上下文任一處
  if (hasLineOaForm(t, { qrContent })) return true;
  if (hasLineOaForm(ctx, { qrContent })) return true;
  return false;
}

/**
 * 處置：永不踢。
 * deleteMessage 預設 true（士軒 11/4；超出現行一般連結只評分，故獨立開關）。
 * warnOnly／learnOnly／不能刪 → 只通知。
 */
export function bandanLineOaAction({
  warnOnly = false,
  learnOnly = false,
  deleteMessage = true,
  canDelete = true,
} = {}) {
  if (learnOnly) return { kick: false, delete: false, notice: false, reason: "learn-only" };
  if (warnOnly) return { kick: false, delete: false, notice: true, reason: "warn-only" };
  if (deleteMessage && canDelete) return { kick: false, delete: true, notice: true, reason: "delete-and-notify" };
  return { kick: false, delete: false, notice: true, reason: deleteMessage ? "no-delete-permission" : "delete-disabled" };
}

/** 從公開頁 HTML 粗抓認證標記與好友／追蹤數（取不到回 undefined 欄位）。 */
export function parseLineOaPage(html = "") {
  const h = String(html ?? "");
  const text = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const verified = /認證帳號|已認證|verified|official\s*account|藍(?:色)?盾|綠(?:色)?盾|blue\s*badge|green\s*badge/i.test(h)
    || /認證帳號|已認證/.test(text);
  let friends;
  const m = text.match(/(?:好友|朋友|Friends?|追蹤者?|followers?)\s*[:：]?\s*([\d,，]+)/i)
    || text.match(/([\d,，]+)\s*(?:位好友|人追蹤|followers?)/i);
  if (m) friends = Number(String(m[1]).replace(/[,，]/g, ""));
  if (!Number.isFinite(friends)) friends = undefined;
  return { verified: verified || undefined, friends, lowFriends: friends !== undefined ? friends < 1000 : undefined };
}

/** 安全抓 OA 公開頁；失敗回 undefined。 */
export async function probeLineOaPage(url, { fetchPage = fetchPageSafe, timeoutMs = 4000 } = {}) {
  if (!url || !LINE_OA_URL.test(url)) return undefined;
  const match = String(url).match(LINE_OA_URL);
  if (!match) return undefined;
  let target = match[0];
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  const html = await fetchPage(target, { timeoutMs }).catch(() => undefined);
  if (!html) return undefined;
  return { url: target, ...parseLineOaPage(html) };
}

/** 從文字抽出第一個 LINE OA URL（給探頁用）。 */
export function firstLineOaUrl(text = "", qrContent = "") {
  const raw = `${text}\n${qrContent}`;
  const m = raw.match(LINE_OA_URL);
  if (!m) return undefined;
  return /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
}
