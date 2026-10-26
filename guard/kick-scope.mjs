// 踢人範圍（維護者 10/26 22:59、23:01、23:02）：守衛「只有」下面兩類可以踢人，其他一律只刪文或只通知。
//   (a) 明確貼出換群／假新群／假二群的群組連結或 QR（含冒用群主＋外部群組邀請 QR）。
//   (b) 確認是詐騙群組、假精品，或假色情 PDF。
// 單看規則計分到門檻、短網址、一頁式購物、假管理員暱稱、跨群相同內容、冒充負責人要匯款……都不踢。
// 不踢的群：設定 kickScope.excludeChats（例：維護者指定的群）、只學習（learnOnly）、只警告（warnOnly）。
// 真管理員、群主、白名單、受保護成員由呼叫端排除（excluded=true），這裡再擋一次。
// 純函式，方便測試（test/guard-kick-scope.test.mjs）。

export const KICK_FAKE_GROUP = "換群／假新群／假二群的群組連結或 QR";
export const KICK_SCAM_GROUP = "確認是詐騙群組";
export const KICK_FAKE_LUXURY = "確認是假精品";
export const KICK_FAKE_PORN_PDF = "確認是假色情 PDF";
export const KICK_CATEGORIES = [KICK_FAKE_GROUP, KICK_SCAM_GROUP, KICK_FAKE_LUXURY, KICK_FAKE_PORN_PDF];

const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[\s\u200b-\u200f\u2060\ufeff\u3000\u2800\u3164]+/g, "");

// LINE 群組／社群邀請（不是加個人好友 ti/p、也不是官方帳號 @）。
export const GROUP_INVITE = /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\/|line\.me\/ti\/g2\//i;
// 換群、新群、二群、備用群、搬家、舊群解散……（叫人「轉移到另一個群」的意思）。
export const MOVE_GROUP = /(新|二|2|副|備用|分|另一?個)(的)?(群|社團|社群|群組)|(換|搬|移|轉|遷)(到|至|去|往)?(新)?(的)?(群|社團|社群|群組)|(群|社群|群組)(搬家|遷移)|舊群.{0,6}(解散|關閉|停用|刪除)|(本|此|這個?|原)(群|社群|群組).{0,8}(刪除|解散|關閉|停用)|重新(加入|➕|\+|進群|入群)|統一(核准|核準|審核)/;
// 規則層已經判到的「換群」類命中名稱（rules.mjs）。
const MOVE_RULE_NAMES = new Set(["假群組公告", "假群組連結", "催促加入新群", "疑似假群組"]);
// 在提醒／詢問（引用別人的詐騙訊息來警告大家）：不踢，照舊通知。
const WARNING = /(?:疑似|可能是?|小心|注意|提醒|警告|防範|謹防|當心).{0,10}(?:詐騙|假群|假冒|冒充|冒用|被騙)|(?:不要|勿|別|切勿|請勿|千萬別|千萬不要)\s*(?:隨便|亂)?\s*(?:加入|點|加|相信|理會|上當|掃)|是詐騙嗎|是不是(詐騙|假的)|這.{0,4}(可信|能信)(嗎|不)|165/;

// 假精品：1:1／複刻／高仿／原單／尾單／AAA／名牌超低價。
export const FAKE_LUXURY = /1[:：比]1|複刻|復刻|高仿|原單|尾單|A{3}級?|頂級(精品|名牌)|精品.{0,4}(複刻|高仿|代購)|名牌.{0,6}(超低價|[1-9]折|特價|出清)|(LV|Gucci|Chanel|香奈兒|愛馬仕|Hermes|Rolex|勞力士|Prada|Dior|Cartier|卡地亞).{0,12}(超低價|[1-9]折|出清|特價|只要\s*[$＄]?\s*\d)/i;
// 假色情 PDF：檔名或文字是 PDF＋色情／外流／偷拍字眼。
export const PDF = /\.pdf\b|PDF|pdf檔|電子書/i;
export const PORN = /色情|成人|18禁|十八禁|裸|露點|外流|偷拍|私密|自拍|約炮|約砲|性愛|無碼|av女優|AV|寫真|全套|福利(片|影片|圖)|老司機|小黃片|情色/i;

/**
 * 判斷這次處置屬於哪一類可以踢的情況；不屬於回 undefined（不踢）。
 * @param {object} input
 * @param {string} [input.text] 訊息、記事本或檔名文字
 * @param {string[]} [input.names] 規則命中名稱
 * @param {string} [input.verdict] 第一層判定
 * @param {string} [input.review] 覆核判定
 * @param {string} [input.qrContent] QR 解碼內容（截圖）
 * @param {string} [input.qrOrigin] "own" | "other" | ...
 * @param {boolean} [input.inviteExpanded] 短網址展開後是群組邀請
 * @param {string} [input.impersonating] 冒用的群主／管理員名字（冒名＋邀請那條）
 * @param {string} [input.shopLevel] 一頁式購物判定等級
 */
export function kickCategory({ text = "", names = [], verdict, review, qrContent, inviteExpanded = false, impersonating, fileName, fileGroupInvite = false } = {}) {
  const raw = `${text ?? ""} ${fileName ?? ""}`;
  const t = norm(raw);
  // 23:15：檔案（PDF 等）裡抽出外部 LINE 群組邀請連結或 QR → 詐騙群組；檔名／內文有色情字眼 → 假色情 PDF。
  if (fileGroupInvite) return PORN.test(t) ? KICK_FAKE_PORN_PDF : KICK_SCAM_GROUP;
  if (WARNING.test(t)) return undefined;
  const confirmed = verdict === "SCAM" && review === "SCAM";
  const reviewed = review === "SCAM";
  const qrGroup = Boolean(qrContent) && GROUP_INVITE.test(String(qrContent));
  const groupLink = GROUP_INVITE.test(raw) || inviteExpanded || qrGroup;
  const move = MOVE_GROUP.test(t) || names.some((n) => MOVE_RULE_NAMES.has(n));
  // (a) 換群／新群／二群＋群組連結或 QR。冒用群主／管理員＋外部群組邀請（連結或 QR）也算。
  if (groupLink && (move || impersonating)) return KICK_FAKE_GROUP;
  // (b) 詐騙群組：外部群組邀請（連結、QR、短網址展開）而且覆核確認 SCAM（文字要兩層都 SCAM；純 QR 截圖只有覆核）。
  if (groupLink && (qrContent && !text ? reviewed : confirmed)) return KICK_SCAM_GROUP;
  // (b) 假精品／假色情 PDF：要有連結或檔案，且兩層都判 SCAM。
  const hasLinkOrFile = /https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(raw) || Boolean(fileName);
  // 假色情 PDF 以「檔案裡有沒有群組 QR／連結」判定（上面 fileGroupInvite）；只有文字說 PDF 不算。
  if (confirmed && hasLinkOrFile && (FAKE_LUXURY.test(t) || names.includes("仿冒精品連結"))) return KICK_FAKE_LUXURY;
  return undefined;
}

/** 這個群可不可以踢（不看內容）。 */
export function kickScopeChat(chatId, { excludeChats = [], learnOnly = new Set(), warnOnly = new Set() } = {}) {
  if (chatId === undefined) return { ok: false, reason: "no-chat" };
  if (learnOnly.has?.(chatId)) return { ok: false, reason: "learn-only" };
  if (warnOnly.has?.(chatId)) return { ok: false, reason: "warn-only" };
  if ((excludeChats ?? []).includes(chatId)) return { ok: false, reason: "kick-scope-excluded" };
  return { ok: true };
}

/** 綜合判斷：可以踢回 { kick: true, category }；不行回 { kick: false, reason }。 */
export function kickScopeDecision({ chatId, excluded = false, scope = {}, ...content } = {}) {
  if (excluded) return { kick: false, reason: "excluded" };
  const chat = kickScopeChat(chatId, scope);
  if (!chat.ok) return { kick: false, reason: chat.reason };
  const category = kickCategory(content);
  if (!category) return { kick: false, reason: "not-kick-category" };
  return { kick: true, category };
}

// ── 23:01：連結無法辨識（被 Cloudflare 擋住）────────────────────
// 只有「明確是 Cloudflare 挑戰／攔截頁」才算無法辨識：cf-mitigated: challenge 標頭，或 Cloudflare 的 403／503 且頁面是挑戰頁。
// 逾時、DNS 失敗、連線錯誤、一般 403／404／5xx 都「不算」（可能只是暫時連不上），照一般流程只評分。
export const CF_CHALLENGE_HTML = /<title>\s*(Just a moment|Attention Required|請稍候|Un instant)|cf-browser-verification|challenge-platform|cf_chl_|cf-challenge|\/cdn-cgi\/challenge-platform/i;
export function classifyFetch({ status, headers = {}, html = "", error } = {}) {
  if (error) return /timeout|abort/i.test(String(error)) ? "timeout" : "network";
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const cloudflare = /cloudflare/i.test(h.server ?? "") || "cf-ray" in h;
  if (/challenge/i.test(h["cf-mitigated"] ?? "")) return "cf-challenge";
  if (cloudflare && (status === 403 || status === 503 || status === 429) && CF_CHALLENGE_HTML.test(html)) return "cf-challenge";
  if (status >= 200 && status < 300) return "ok";
  return `http-${status ?? "unknown"}`;
}
/** 要不要走「無法辨識 → 刪文＋引用留言＋私下回報」：只有 cf-challenge，而且網域不在放行清單、群和發訊者都在範圍內。 */
export function unrecognizedLinkAction({ kind, allowed = false, excluded = false, chatId, scope = {} } = {}) {
  if (kind !== "cf-challenge") return { act: false, reason: kind ?? "unknown" };
  if (allowed) return { act: false, reason: "allowlisted" };
  if (excluded) return { act: false, reason: "excluded" };
  const chat = kickScopeChat(chatId, scope);
  if (!chat.ok) return { act: false, reason: chat.reason };
  return { act: true };
}
export const UNRECOGNIZED_REPLY = "⚠️ 反詐小幫手：這則訊息裡的連結無法辨識內容，不提供放在群組，已先刪除；需要的話請私下詢問管理員。（AI代理）";

// ── 23:02：一般投資訊息、一般分享不列入詐騙評分 ──────────────────
// 主題是投資／行情／新聞／一般分享，而且「沒有」導流（拉人進群、保證獲利、帶單、招募……）。
// 23:07 起：加好友（賴、LINE ID、加好友連結／QR、私聊）與入金（教入金、談入金）不算導流，也不列入詐騙評分。
const SHARE_TOPIC = /入金|出金|儲值|股|ETF|大盤|台股|美股|指數|殖利率|財報|營收|升息|降息|匯率|通膨|行情|K線|均線|比特幣|BTC|ETH|以太|幣價|黃金|油價|基金|債券|新聞|報導|分享|文章|影片|推薦一?下|看到|心得|整理/i;
const LURE = /群|社群|社團|匯款|轉帳|保證|穩賺|穩定(獲利|收益)|翻倍|帶單|老師|投顧|跟單|報牌|明牌|飆股|內線|邀請碼|錢包地址|借|貸|兼職|日領|月入|名額|免費(領|送|加入)|點擊|點我|諮詢/i;
/** benignOnly：訊息裡的連結都是放行網站（主流影音／新聞／知識），或沒有連結。 */
export function plainInfoShare(text, { ruleNames = [], benignOnly = true } = {}) {
  const t = String(text ?? "").normalize("NFKC");
  if (!benignOnly) return false;
  // 23:07：談入金會中「投資帶單」那條（入金字眼）；文字沒有真的帶單／保證獲利（LURE）就不算。
  const deposit = /入金|出金|儲值/.test(t);
  if (ruleNames.some((n) => !(deposit && n === "投資帶單"))) return false;
  if (!SHARE_TOPIC.test(t)) return false;
  return !LURE.test(t.replace(/https?:\/\/\S+/gi, " "));
}

// ── 23:07：加好友（個人）不列入詐騙；只回一則溫和備註 ───────────────
// 「加好友」只指個人好友：賴：／LINE ID／加我好友／ti/p 加好友連結／lin.ee／私聊。LINE 群組／社群邀請不算（照 22:59 換群規則）。
export const FRIEND_ADD = /加\s*(?:我\s*)?(?:的\s*)?(?:賴|line|好友|LINE)|賴\s*[:：]|line\s*(?:id)?\s*[:：]|\bID\s*[:：]|line\.me\/(?:R\/)?ti\/p\/|lin\.ee\/|私(?:訊|聊|我)|密我/i;
export const FRIEND_NOTE = "網路交友需謹慎，要防止被詐騙，而且交友是個人行為，與群組無關。（AI代理）";
/** 是「只有加好友」的訊息（沒有群組邀請、沒有換群字眼）。qrContent：截圖 QR 內容。 */
export function friendAddOnly(text = "", { qrContent } = {}) {
  const raw = `${text ?? ""} ${qrContent ?? ""}`;
  if (GROUP_INVITE.test(raw) || MOVE_GROUP.test(norm(raw))) return false;
  if (qrContent) return /line\.me\/(?:R\/)?ti\/p\/|lin\.ee\//i.test(qrContent);
  const t = String(text).normalize("NFKC");
  // 夾了保證獲利、帶單、招募這類導流 → 不算單純交友，照一般流程（只通知，不踢）。
  return FRIEND_ADD.test(t) && !LURE.test(t.replace(/https?:\/\/\S+/gi, " "));
}
/** 備註要不要發：只學習的群不發；只警告群可以發；同人同群 cooldownMs 內只發一次。 */
export function makeFriendNoteGate({ cooldownMs = 6 * 3600_000, now = () => Date.now() } = {}) {
  const last = new Map();
  return ({ chatId, senderId, learnOnly = new Set() }) => {
    if (learnOnly.has?.(chatId)) return false;
    const key = `${chatId} ${senderId}`;
    const t = now();
    if (t - (last.get(key) ?? -Infinity) < cooldownMs) return false;
    last.set(key, t);
    if (last.size > 5000) last.delete(last.keys().next().value);
    return true;
  };
}
