// 冒名升級踢人（維護者核准）：全域 kickMode=notify 時，只有下列條件「全部」成立才直接踢，其餘維持只通知。
// 1. 暱稱含看不見的字元（U+2800 點字空白、零寬字元、韓文填充字…）。
// 2. 去掉這些字元後，跟「同一個社群」的群主／管理員名字相同或近似（不跨社群比對）。
// 3. 這則訊息（或記事本）經模型確認是詐騙，而且內容是假群組公告／叫人進新群、二群、新社團（含邀請連結或短網址）。
// 4. 不像其他管理員設的反詐機器人（引用／警告詐騙、自稱反詐、提醒不要點）。
// 5. 不是真管理員、群主、受保護成員或白名單；群級模式（只學習、只警告、本帳號不能踢）由呼叫端照舊處理。
// 不確定就不踢。

export const INVISIBLE_CHARS = /[\u2800\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u00AD\u034F\u115F\u1160\u3164\uFFA0\u180E\u17B4\u17B5\u{E0000}-\u{E007F}]/u;

export const hasInvisibleChars = (name) => INVISIBLE_CHARS.test(String(name ?? ""));

const INVITE_LINK = /line\.me\/(?:ti\/g2?|R\/ti\/g|ti\/p)\/|line\.me\/R\/|lin\.ee\/|liff\.line\.me|(?:reurl\.cc|bit\.ly|tinyurl\.com|t\.co|lihi\d?\.(?:cc|com|me)|pse\.is|ppt\.cc|is\.gd|shorturl\.at|goo\.gl|cutt\.ly|rb\.gy|s\.id)\//i;
const MOVE_GROUP = /(新|二|2|副|備用|分)\s*(群|社團|社群|群組)|(換|搬|移|轉)\s*(到|至|去)?\s*(新)?\s*(群|社團|社群|群組)|重新\s*(加入|➕|\+|進群)|統一\s*核准|進\s*(新)?群|加入\s*(新|二)/;

/** 內容是不是叫人去新群／二群／新社團（公告式），或帶群組邀請連結／短網址。 */
export function fakeGroupContent(text, ruleNames = []) {
  const value = String(text ?? "");
  if (ruleNames.includes("假群組公告")) return true;
  if (INVITE_LINK.test(value) && (MOVE_GROUP.test(value) || /line\.me\/(?:ti\/g2?|R\/ti\/g)\//i.test(value))) return true;
  return MOVE_GROUP.test(value) && /(公告|通知|請大家|全體|各位|成員|即日起|明日|今天|點擊|連結|網址|http)/.test(value);
}

/** 看起來像別的反詐機器人或在提醒大家（引用、警告詐騙、自稱反詐、叫人不要點）。 */
export function looksLikeAntiScamBot(text) {
  const value = String(text ?? "");
  return /反詐|防詐|打詐|詐騙(警告|提醒|通知|防範)|疑似(詐騙|假)|小心(詐騙|假)|(不要|勿|別)\s*(點|加|匯款|相信|理會)|請管理員(確認|留意)|是詐騙|假(的)?(群|公告)|⚠|🚨|機器人|bot\b|守護|警示/i.test(value);
}

/**
 * @param {object} input
 * @param {string} input.senderName 原始暱稱
 * @param {string[]} input.adminNames 同一社群的群主／管理員名字（原始）
 * @param {(s:string)=>string} input.normalizeName
 * @param {(a:string,b:string)=>boolean} input.looksLike
 * @param {string} input.text 訊息或記事本內容
 * @param {string[]} [input.ruleNames] 規則命中名稱
 * @param {string} [input.verdict] 第一層模型判定
 * @param {string} [input.model]
 * @param {string} [input.review] 覆核模型判定（有覆核就必須是 SCAM）
 * @param {boolean} input.excluded 真管理員／群主／受保護／白名單／本帳號
 * @returns {{ kick: boolean, reason: string, victim?: string }}
 */
export function decideImpersonationKick({ senderName, adminNames = [], normalizeName, looksLike, text, ruleNames = [], verdict, model, review, excluded }) {
  if (excluded) return { kick: false, reason: "excluded" };
  if (!hasInvisibleChars(senderName)) return { kick: false, reason: "no-invisible" };
  const key = normalizeName(senderName);
  const victim = adminNames.find((name) => looksLike(key, normalizeName(name)));
  if (!victim) return { kick: false, reason: "no-same-community-admin" };
  if (verdict !== "SCAM" || !model) return { kick: false, reason: "model-not-scam" };
  if (review !== undefined && review !== "SCAM") return { kick: false, reason: "review-not-scam" };
  if (!fakeGroupContent(text, ruleNames)) return { kick: false, reason: "not-fake-group" };
  if (looksLikeAntiScamBot(text)) return { kick: false, reason: "anti-scam-bot-like" };
  return { kick: true, reason: "impersonation-fake-group", victim };
}
