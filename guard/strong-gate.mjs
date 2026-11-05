// 士軒 11/5 14:43：「重新整理詐騙評分標準：6 分以上、符合詐欺特徵的才標註並踢人；低分的正常網址、網站、真正分享文、工具，不回應也不備註。」
// 對外（群內）發言的總閘：只有「具體詐騙強特徵」才標註（通知）；其他一律不發（只記日誌供稽核）。
// 強特徵：kick-scope 的四類（換群／假群連結或 QR、詐騙群組、假精品、假色情 PDF）＋短網址導向群組邀請／已知詐騙邀請碼＋帶單 LINE@ 假老師＋仿冒官方釣魚。
// 分數：確認的強特徵有效分數拉到至少 6 分（STRONG_MIN_SCORE），不是放寬；沒有強特徵的，規則分數再高也不發。
// 踢人仍只走 kick-scope（範圍、excludeChats、warnOnly、learnOnly、頂層 kickMode 都不變）。
// 純函式，方便測試（test/guard-strong-gate.test.mjs）。
import { kickCategory } from "./kick-scope.mjs";
import { BANDAN_LINE_OA } from "./line-oa-bandan.mjs";
import { FAKE_LOGISTICS_URL, FAKE_LOGISTICS_VERIFY } from "./notify-rules.mjs";
import { KNOWN_SCAM_INVITE } from "./known-scam-invite.mjs";

export const STRONG_MIN_SCORE = 6;
export const STRONG_BANDAN = "帶單 LINE@ 假老師";
export const STRONG_PHISHING = "仿冒官方釣魚";
export const STRONG_SCAM_SHOP = "一頁式詐騙購物";
// 士軒 11/5 18:21：短網址展開後落在 LINE 群組／社群邀請 → 強特徵（不再只靠兩層 LLM 判 SCAM）；外觀與換群／假群連結同一類處置。
export const STRONG_SHORT_INVITE = "短網址導向群組邀請";
// 一頁式詐騙購物：規則分數本身 ≥6（不拉分）、覆核判 SCAM、且有貨到付款或名牌低價（頁面或文字）才算。
const SHOP_STRONG = new Set(["貨到付款", "名牌低價", "頁面：貨到付款", "頁面：名牌低價"]);
// 仿冒官方釣魚：本身就要求「仿冒＋騙資料」的命中名稱；只有多層子網域仿物流網址的，要覆核也判 SCAM。
const PHISHING_NAMES = new Set([FAKE_LOGISTICS_VERIFY, "仿冒交易所網域", "釣魚彈窗連結帳號領額度"]);

/** 回強特徵類別；沒有回 undefined。entry：判定紀錄（names／verdict／review）；content：訊息原文、QR、檔名等（不進日誌）。 */
export function strongFeature(entry = {}, content = {}) {
  const names = entry.names ?? [];
  const category = kickCategory({
    text: content.text ?? "", fileName: content.fileName, names,
    verdict: entry.verdict === "QR_LINE_INVITE" ? undefined : entry.verdict, review: entry.review,
    qrContent: content.qrContent, fileGroupInvite: content.fileInvite === true,
    inviteExpanded: names.includes("短網址導向群組邀請"), impersonating: entry.impersonating ?? entry.victim ?? names.find((n) => /^冒用「/.test(String(n))),
  });
  if (category) return category;
  // 短網址（含 xxx.pse.is 子網域）展開成群組／社群邀請，或命中已確認詐騙邀請碼 → 強特徵（有效分數拉到 ≥6）。
  if (names.includes(STRONG_SHORT_INVITE) || names.includes(KNOWN_SCAM_INVITE)) return STRONG_SHORT_INVITE;
  if (names.includes(BANDAN_LINE_OA)) return STRONG_BANDAN;
  if (names.some((name) => PHISHING_NAMES.has(name))) return STRONG_PHISHING;
  if (names.includes(FAKE_LOGISTICS_URL) && entry.review === "SCAM") return STRONG_PHISHING;
  if (entry.verdict === "SCAM_SHOP" && entry.review === "SCAM" && Number(entry.score) >= STRONG_MIN_SCORE && (entry.signals ?? []).some((n) => SHOP_STRONG.has(n))) return STRONG_SCAM_SHOP;
  return undefined;
}

/** 有效分數：確認的強特徵至少 6 分。 */
export function effectiveScore(entry = {}, feature) {
  const score = Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0;
  return feature ? Math.max(score, STRONG_MIN_SCORE) : score;
}

/** 群內要不要發（通知、處理中、已處置、溫和備註都算）。 */
export function outboundGate(entry = {}, content = {}, { enabled = true } = {}) {
  if (!enabled) return { send: true, reason: "gate-off" };
  const feature = strongFeature(entry, content);
  const score = effectiveScore(entry, feature);
  if (!feature) return { send: false, reason: "no-strong-feature", score };
  if (score < STRONG_MIN_SCORE) return { send: false, reason: "below-6", score, feature };
  return { send: true, feature, score };
}
