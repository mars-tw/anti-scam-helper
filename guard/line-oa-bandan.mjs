// 士軒 11/4 20:26：詐騙「帶單老師」LINE@／官方帳號引流。
// 辨識：LINE@ 形式（@ID、lin.ee、page.line.me、line.me/R/ti/p/@、官方帳號分享卡／截圖）＋老師／帶單／跟單語意＋投資語境。
// 處置：永不踢；刪文看設定（預設關＝只通知；Hao0321／warnOnly／excludeChats／learnOnly 不刪）。
// 刪文超出現行 10/26「一般連結只評分」：獨立開關 bandanLineOa.deleteMessage，預設 false。
// 交易所官方：查證過的 LINE@ ID／page 路徑才白名單；品牌名不夠放行。品牌＋跟單教學、無私人老師帶單語意 → 不判詐騙。

import { fetchPageSafe } from "./shop.mjs";

export const BANDAN_LINE_OA = "帶單老師 LINE@／官方帳號引流";

const NFKC = (s) => String(s ?? "").normalize("NFKC");

/** LINE 官方帳號／OA 連結形式。 */
export const LINE_OA_URL = /(?:https?:\/\/)?(?:lin\.ee\/[A-Za-z0-9_-]+|page\.line\.me\/[^\s<>"'）)】]+|line\.me\/(?:R\/)?ti\/p\/@[A-Za-z0-9._-]+)/i;

/** 加 LINE@／官方帳號分享卡用語。 */
export const LINE_OA_SHARE = /LINE\s*官方帳號|官方帳號(?:分享|卡片|QR|二維)?|加入官方帳號|加\s*LINE\s*@|掃描.{0,6}官方|官方\s*QR/i;

/** 帶上下文的 @帳號（避免一般 @提及誤中）。 */
export const LINE_OA_AT = /(?:加|賴|line\s*id|LINE\s*ID|官方(?:帳號)?|老師|帳號|好友)\s*[:：]?\s*@([a-z0-9][\w.-]{2,30})\b/i;

/**
 * 私人老師／帶單語意（穩賺、翻倍單靠不夠——商家「雙11 穩賺優惠」不可命中）。
 * 需老師／帶單／跟單／喊單／投顧／報牌等，另見 hasBandanLure 的投資語境。
 */
export const BANDAN_TEACHER = /帶單|喊單|老師帶|投顧老師|操盤老師|帶單老師|跟單老師|報牌|明牌|招收學員|學員名額|進群帶|帶你賺|保證獲利|免費諮詢.{0,8}(?:帶|跟|賺)|分析師.{0,8}(?:一對一|帶|跟)|老師.{0,10}(?:帶單|跟單|獲利|賺錢|加|私)|(?:賺錢|獲利).{0,10}(?:老師|帶單)|跟單(?:老師|名額|保證)|推薦.{0,6}老師|老師.{0,8}學員|學員(?:不多|有限|名額)/i;

/** 單獨「跟單」字樣（交易所跟單功能也會用；要搭配投資語境，且排除官方跟單教學軟放行）。 */
export const GENDAN = /跟單/;

/** 查證過的交易所官方 LINE@（比照 47bf1ae 官方網域清單：只放有公開證據的）。
 * 2026-11-04：Pionex 派網 page.line.me/021gojrr（Verified）。
 * Binance／Bybit／OKX：公開資料未見穩定可查證的台灣 LINE@ ID，故不列入；改依品牌＋跟單教學軟放行。 */
export const OFFICIAL_EXCHANGE_LINE_OA = [
  { brand: "pionex", ids: ["021gojrr"], note: "https://page.line.me/021gojrr Verified 2026-11-04" },
];

export const EXCHANGE_BRAND = /幣安|binance|bybit|派網|pionex|okx|歐易/i;

/** 交易所「跟單交易教學／功能」用語（正常產品介紹，不是私人帶單老師）。 */
export const EXCHANGE_COPY_TEACH = /跟單(?:交易)?(?:教學|功能|說明|介紹|怎麼用|攻略|指南|設定)|(?:教學|介紹|說明|攻略).{0,10}跟單|官方.{0,8}跟單|跟單交易/i;

/** 私人老師帶單語意：有這些就不走交易所軟放行。 */
export const PRIVATE_TEACHER_LURE = /老師帶|帶單老師|跟單老師|投顧老師|操盤老師|私人.?老師|一對一.{0,8}(?:帶|跟)|保證獲利|招收學員|學員名額|報牌|明牌|喊單|帶你賺|加我.{0,8}(?:跟單|帶單)|私訊.{0,8}(?:帶|跟|老師)|帶單(?!交易)|推薦.{0,6}老師|老師.{0,8}學員|學員(?:不多|有限)/i;

const ANTI_WARN = /(?:疑似|可能是?|小心|注意|提醒|警告|防範|謹防).{0,10}(?:詐騙|假)|是詐騙嗎|是不是詐騙|165/i;

/** 投資語境（無 magento 誤植）。 */
export const HAS_INVEST_CTX = /幣|股|合約|期貨|交易|投資|獲利|操盤|投顧|加密|btc|eth|虛擬|外匯|黃金|大盤|明牌|報牌|喊單|帶單|老師|跟單|幣安|幣圈|派網|bybit|okx|pionex|歐易|binance/i;

/** 從文字／QR 抽出可能的 LINE@ ID（小寫、去 @）。 */
export function extractLineOaIds(text = "", qrContent = "") {
  const raw = `${NFKC(text)}\n${NFKC(qrContent)}`;
  const ids = new Set();
  for (const m of raw.matchAll(/line\.me\/(?:R\/)?ti\/p\/@([A-Za-z0-9._-]+)/gi)) ids.add(m[1].toLowerCase());
  for (const m of raw.matchAll(/page\.line\.me\/@?([A-Za-z0-9._-]+)/gi)) ids.add(m[1].toLowerCase().replace(/^@/, ""));
  // LINE_OA_AT 本身無 g；複製一份帶 g 再 matchAll
  for (const m of raw.matchAll(new RegExp(LINE_OA_AT.source, "gi"))) ids.add(String(m[1]).toLowerCase());
  for (const m of raw.matchAll(/LINE\s*官方帳號[^@]{0,20}@([a-z0-9][\w.-]{2,30})\b/gi)) ids.add(m[1].toLowerCase());
  return [...ids];
}

/** 是否命中查證過的交易所官方 LINE@（只比 ID／page 路徑，品牌名不夠）。 */
export function isOfficialExchangeLineOa(text = "", { qrContent } = {}) {
  const ids = extractLineOaIds(text, qrContent);
  if (!ids.length) return false;
  const allowed = new Set(OFFICIAL_EXCHANGE_LINE_OA.flatMap((e) => e.ids.map((id) => id.toLowerCase())));
  return ids.some((id) => allowed.has(id));
}

/**
 * 交易所品牌＋跟單教學／官方跟單介紹，且無私人老師帶單語意 → 不應當帶單老師詐騙。
 * 只提品牌名不夠；仿冒「幣安官方」＋老師帶單仍要命中。
 */
export function isExchangeOfficialCopyTrade(text = "") {
  const t = NFKC(text);
  if (!EXCHANGE_BRAND.test(t)) return false;
  if (PRIVATE_TEACHER_LURE.test(t)) return false;
  if (EXCHANGE_COPY_TEACH.test(t)) return true;
  // 「幣安官方帳號 … 跟單…」無老師／帶單私人語意
  if (/官方帳號|官方\s*(?:LINE|帳號)/i.test(t) && GENDAN.test(t) && !/帶單|老師/.test(t)) return true;
  return false;
}

/**
 * 11/4 17:16／17:39 漏擋：看圖理由只寫「LINE 官方綠色 QR code」，沒有 @ID 可抽。
 * 只用在看圖理由（vision: true）；一般文字仍要 @ID／連結，避免聊天提到「官方帳號」誤中。
 */
export const LINE_OA_VISION = /LINE\s*@|LINE\s*官方(?:帳號)?|官方帳號.{0,6}(?:QR|二維|條碼|截圖|分享卡|名片)|OA\s*QR/i;
const VISION_NEGATED = /(?:無|沒有|未見|不含|並非|不是).{0,8}(?:QR|LINE|官方帳號)/i;

/** 展開後的網址是不是 LINE 官方帳號加好友頁（@ID、lin.ee、page.line.me）。個人 ti/p/~ 不算。 */
export function isLineOaUrl(url = "") {
  return LINE_OA_URL.test(String(url ?? ""));
}

/** 這段文字／QR 是否指向 LINE 官方帳號（含 OA 加好友連結）。vision：看圖理由，可用「LINE 官方 QR」描述。 */
export function hasLineOaForm(text = "", { qrContent, vision = false } = {}) {
  const raw = `${NFKC(text)}\n${NFKC(qrContent)}`;
  if (vision && LINE_OA_VISION.test(NFKC(text)) && !VISION_NEGATED.test(NFKC(text))) return true;
  if (LINE_OA_URL.test(raw)) return true;
  if (qrContent && /line\.me\/(?:R\/)?ti\/p\/@|lin\.ee\/|page\.line\.me/i.test(String(qrContent))) return true;
  if (LINE_OA_AT.test(raw)) return true;
  if (LINE_OA_SHARE.test(raw) && /@[a-z0-9]/i.test(raw)) return true;
  return false;
}

/**
 * 帶單／跟單語意：必須有老師／帶單／跟單等用語，且有投資語境。
 * 單靠「穩賺」「翻倍」不夠（商家優惠反例）。
 */
export function hasBandanLure(text = "") {
  const t = NFKC(text);
  if (!HAS_INVEST_CTX.test(t)) return false;
  if (BANDAN_TEACHER.test(t)) return true;
  if (GENDAN.test(t)) return true;
  return false;
}

/**
 * 帶單老師 LINE@：要同時有「帶單語意」與「LINE OA 形式」。
 * contextText：同人前後短時間內的帶單文／看圖理由（給 QR 接續用）。
 */
export function isBandanLineOa(text = "", { qrContent, contextText = "", protectedSender = false, vision = false } = {}) {
  if (protectedSender) return false;
  const t = NFKC(text);
  const ctx = NFKC(contextText);
  const all = `${t}\n${ctx}\n${NFKC(qrContent)}`;
  // 純防詐提醒、沒有自己的帶單引流字眼 → 不算
  if (ANTI_WARN.test(t) && !hasBandanLure(t) && !hasBandanLure(ctx)) return false;
  // 查證過的交易所官方 LINE@ ID → 放行（品牌名不夠）
  if (isOfficialExchangeLineOa(all, { qrContent })) return false;
  // 品牌＋跟單教學、無私人老師帶單 → 不判
  if (isExchangeOfficialCopyTrade(all)) return false;
  if (!hasBandanLure(all)) return false;
  // OA 可在本則、QR 或上下文任一處
  if (hasLineOaForm(t, { qrContent, vision })) return true;
  if (hasLineOaForm(ctx, { qrContent })) return true;
  return false;
}

/**
 * 處置：永不踢。
 * deleteMessage 預設 false（Grok Bot 審 2876d68：先只通知）。
 * warnOnly／learnOnly／excludeChats／不能刪 → 不刪。
 */
export function bandanLineOaAction({
  warnOnly = false,
  learnOnly = false,
  excludeChat = false,
  deleteMessage = false,
  canDelete = true,
} = {}) {
  if (learnOnly) return { kick: false, delete: false, notice: false, reason: "learn-only" };
  if (warnOnly) return { kick: false, delete: false, notice: true, reason: "warn-only" };
  if (excludeChat) return { kick: false, delete: false, notice: true, reason: "kick-scope-excluded" };
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
