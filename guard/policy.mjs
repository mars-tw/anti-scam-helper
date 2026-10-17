// 判定與處置政策（純函式，測試見 test/guard-policy.test.mjs）。
// 目的：減少誤判（地端小模型、看圖模型、冒名比對），但不漏掉真正的詐騙。

// 「有沒有具體的詐騙訊號」：連結、LINE 邀請／ID、金錢或投資字眼、私下聯繫。
// 規則 0 分、又沒有這些訊號的短訊息，地端小模型判 SCAM 也只是雜訊（原本就不會送覆核），乾脆不問它。
const LINK = /https?:\/\/|www\.|(?<![\w.@-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[\w-]|line\.me|lin\.ee/i;
const LINE_ID = /(line|賴)\s*(id)?\s*[:：]|加\s*(我\s*)?(賴|line)/i;
const MONEY = /匯款|轉帳|入金|出金|儲值|投資|獲利|報酬|收益|穩賺|保證|帶單|飆股|股票|老師|虛擬貨幣|加密貨幣|USDT|泰達幣|幣圈|貸款|借錢|博弈|娛樂城|百家樂|中獎|領取|兼職|刷單|日領|日結|月入|私訊|私聊|密我|加好友|免費領|優惠碼|折扣碼|領紅包|紅包|點數/i;

export function hasLink(text) { return LINK.test(String(text ?? "")); }

export function hasScamSignal(text) {
  const t = String(text ?? "").normalize("NFKC");
  return LINK.test(t) || LINE_ID.test(t) || MONEY.test(t);
}

/** 規則 0 分時要不要交給地端模型：有訊號、或訊息較長（> longChars）才問。 */
export function shouldScreenLocally({ score, text, longChars = 40 }) {
  if (score > 0) return true;
  const t = String(text ?? "");
  return hasScamSignal(t) || t.replace(/\s/g, "").length > longChars;
}

/** 規則名稱裡代表「有連結」的項目（連結、短網址、LINE 邀請）。 */
export const LINK_RULES = new Set(["網址", "短網址", "LINE 邀請／加好友"]);

/**
 * 最終處置：
 * - kick：規則 ≥ strongScore 且地端判 SCAM 且 Meta 判 SCAM（不放寬）。
 * - notice：Meta 判 SCAM，且（規則 ≥ notifyScore，或地端也判 SCAM 且訊息含連結）→ 引用回覆那則訊息通知管理員。
 * - none：其他。
 */
export function decideAction({ score, verdict, review, names = [], strongScore = 6, notifyScore = 3, link, deleteOnLink = false, canDelete = false }) {
  if (review !== "SCAM") return "none"; // Meta 不可用／不確定／OK：一律不處置（只記錄）
  if (score >= strongScore && verdict === "SCAM") return "kick";
  const bothScam = verdict === "SCAM";
  // 地端＋Meta 都判 SCAM，而且真的含外部連結（白名單連結已先被換掉）：本帳號能刪的群 → 先通知再刪訊息（不踢）。
  if (bothScam && link === true && deleteOnLink && canDelete) return "delete";
  if (score >= notifyScore) return "notice";
  if (bothScam && (link === true || names.some((name) => LINK_RULES.has(name)))) return "notice";
  return "none";
}

// 看圖模型判 SCAM 時，理由裡要有「具體的引流或要錢訊號」才算數；
// 只看到軟體畫面、用量上限、官方公告、技術說明、電影截圖這類，就降為不採計（只記錄，不當成詐騙）。
const VISION_CONCRETE = /QR|二維碼|條碼|加.{0,4}(LINE|line|賴|好友|群)|LINE\s*ID|ID\s*[:：]|網址|連結|http|www\.|私訊|聯繫|聯絡|匯款|轉帳|入金|出金|帶單|保證(獲利|賺)|穩賺|投資群|老師|飆股|娛樂城|博弈|百家樂|中獎|領取|兼職|日領|刷單任務|貸款|裸|色情|約炮|援交|外送茶/i;
const VISION_BENIGN = /介面|畫面|截圖.{0,6}(軟體|程式|設定|後台)|用量|上限|額度|重置|官方公告|公告|robots|文件|程式碼|終端機|指令|設定|電影|迷因|新聞|模型名稱|token\s*價格|主機|伺服器|部署/i;

export function visionCounts(reason) {
  const r = String(reason ?? "");
  if (!VISION_CONCRETE.test(r)) return false;
  // 只有「刷單」「虛擬貨幣」這類名詞出現在技術畫面描述裡，不算（要有引流或要錢的動作）。
  if (VISION_BENIGN.test(r) && !/QR|二維碼|加.{0,4}(LINE|line|賴|好友)|LINE\s*ID|匯款|轉帳|入金|私訊|聯繫/i.test(r)) return false;
  return true;
}

/** 社群（OpenChat）的識別：頻道名稱「社群名 / 聊天室名」取前半；同一社群的不同聊天室共用成員 id。 */
export function squareKey(channelName) {
  return String(channelName ?? "").split(" / ")[0].trim();
}

/**
 * 同一社群內的冒名比對。admins：Map(正規化名字 → { name, ids:Set })；adminIds：這個社群所有已知管理員的成員 id。
 * 發言者 id 本身是管理員（或是被比對那位管理員的 id）就不算冒名。回傳被冒用的名字或 undefined。
 */
export function findImpersonated({ nameKey, senderId, admins, adminIds = new Set(), looksLike }) {
  if (adminIds.has(senderId)) return undefined;
  for (const [key, admin] of admins ?? []) {
    if (admin.ids?.has(senderId)) return undefined;
    if (looksLike(nameKey, key)) return admin.name;
  }
  return undefined;
}

// ── 連結白名單 ───────────────────────────────────────────────
export function normalizeUrl(url) {
  return String(url ?? "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[?#]/)[0].replace(/\/$/, "").replace(/\/(tw|th|jp|en|zh-hant)\/cover\//i, "/cover/").toLowerCase();
}
export const LINE_URL = /(https?:\/\/)?([\w-]+\.)*(line\.me|lin\.ee)\/[^\s，。）)」』]*/gi;
export const LINE_INVITE_PATH = /^(([\w-]+\.)*line\.me\/(ti\/|r\/ti\/|r\/msg\/)|lin\.ee\/|openchat\.line\.me\/)/i;
const ANY_URL = /(https?:\/\/)?(?<![\w.@-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s，。）)」』]*/gi;

/**
 * 把白名單（自家群）連結換成［本社群官方連結］、LINE 官方一般頁面換成［LINE 官方網站］，其餘連結原樣保留。
 * official：至少有一個白名單連結；officialOnly：有白名單連結，而且換掉之後沒有任何其他外部連結。
 * 只有 officialOnly 才能整則略過；混了外部連結就照一般流程判斷外部連結。
 */
export function sanitizeLinks(text, allow = []) {
  let official = false;
  const allowed = (url) => { const key = normalizeUrl(url); return allow.some((prefix) => key === prefix || key.startsWith(`${prefix}/`)); };
  let cleaned = String(text ?? "").replace(LINE_URL, (url) => {
    if (allowed(url)) { official = true; return "［本社群官方連結］"; }
    if (!LINE_INVITE_PATH.test(normalizeUrl(url))) return "［LINE 官方網站］";
    return url;
  });
  // 白名單裡也可以放非 LINE 的自家網址。
  cleaned = cleaned.replace(ANY_URL, (url) => (allowed(url) ? ((official = true), "［本社群官方連結］") : url));
  return { text: cleaned, official, officialOnly: official && !hasLink(cleaned) };
}

// ── 自動回覆：守衛處置與權限的即時事實 ─────────────────────────
// 回覆時依「目前執行中的設定」產生事實給模型（不寫死），讓它照實回答；不透露設定細節、門檻、金鑰、模型名稱、ID 或其他成員資料。
export const MODERATION_REPLY = "這要等本人回覆"; // 後置過濾的替換句（回覆否認事實或替本人承諾時）
export const ESCALATE_REPLY = "這個我會轉給本人處理"; // 需要本人決定的事（邀回某人、替特定人申訴、補償）：唯一允許的承諾句

/** isAdmin：本帳號在這個群是不是管理員（true／false；undefined＝不確定，不提）。 */
export function buildGuardFacts({ kickMode = "kick", deleteOnLink = false, metaAvailable = true, isAdmin } = {}) {
  const facts = [
    "本帳號在這幾個社群裡執行反詐騙守衛（自動程式），會偵測：假的「換群／搬家／新群」公告、引流或廣告連結、冒用管理員名字、外部 LINE 群組／好友的 QR code 或 LINE ID。",
    kickMode === "notify" ? "踢人功能目前暫停，只通知管理員。" : "確認是詐騙的帳號，守衛可能會把對方移出社群，並先發通知說明。",
  ];
  if (isAdmin === true) {
    facts.push("本帳號在這個群是管理員。");
    if (deleteOnLink && metaAvailable) facts.push("在這個群，確認是詐騙的連結訊息，守衛會先發通知再刪除那則訊息。");
  } else if (isAdmin === false) {
    facts.push("本帳號在這個群不是管理員，守衛在這裡只能發通知，請管理員處理。");
  }
  facts.push("如果覺得自己被誤判，可以聯絡這個群的管理員。");
  return `【守衛現況（真實資訊，回答相關問題時照這些說，不要自己猜或補充）】
${facts.map((fact) => `- ${fact}`).join("\n")}
【硬規則】不要透露設定細節、分數門檻、金鑰、模型名稱、成員 ID 或其他成員的資料；不要猜測某個人被處理的具體原因或經過，也不要說出和上面現況相反的話（例如本帳號是管理員卻說沒有權限）。
有人要求把某人邀回來、替特定的人申訴、要求補償，或其他需要本人決定的事，整個回答只寫「${ESCALATE_REPLY}」。`;
}

/** 回覆是否否認或捏造處置事實：說「沒有踢人」、或和本群管理員身分相反、或在踢人暫停時說會踢。 */
export function isFalseModerationClaim(text, { isAdmin, kickMode = "kick" } = {}) {
  const t = String(text ?? "");
  if (/(沒有?|不會|從來沒|並沒有?)\s*(在)?(踢|剔|移出|移除)(人|他|她|任何人)?|沒有?把.{0,8}(踢|剔|移出|移除)/.test(t)) return true;
  if (isAdmin === true && /(沒有?|無)(任何)?(管理員|管理)?(的)?(權限|管理權)|不是(這個群的?)?管理員|我不是管理|沒有管理員(身分|資格)/.test(t)) return true;
  if (isAdmin === false && /我(是|有)(這個群的?)?管理員|我有(管理)?權限/.test(t)) return true;
  if (kickMode === "notify" && /(會|將|已經?)(把.{0,8})?(踢|移出)(社群|群組|出去)?/.test(t) && !/暫停/.test(t)) return true;
  return false;
}

// ── 自動回覆：不替本人承諾 ──────────────────────────────────────
// 第一人稱的未來行動或承諾（我會／我再／我來／我幫你／我改／我調／下次我／保證／答應／約／付錢…）→ 整段換成固定句。
// 一般建議（你可以…、建議…、不要匯款、沒有人能保證獲利）與當下的說明（我來說明、我覺得、我會建議）不算。
const NOW_ACTS = "說明|解釋|回答|分享|整理|總結|補充|舉例|列出|翻譯|強調|提醒|說|講";
const PROMISE = new RegExp([
  `(我|讓我)(會|再|來|去|幫你|幫妳|替你|晚點|等等|等一下|稍後|馬上|立刻|回頭|找時間|有空|之後|明天|今晚|改天)(?!${NOW_ACTS}|建議|覺得|認為|推薦|猜|想說|不會|沒有|不知道)`,
  "下次(我|再)",
  "我(改|調|處理|修改|弄|安排|負責|保證|答應|一定)",
  "(跟你|向你)保證|答應你|一言為定|說定了|包在我身上|交給我",
  "(我們|我跟你|跟你).{0,4}約|約你|約個時間|約好(了|囉|喔|啦)",
  "(我|讓我).{0,6}(付錢|付款|匯款|轉帳|匯給你|轉給你|付給你|請客|請你吃)",
].join("|"));
export function isPromise(text) { return PROMISE.test(String(text ?? "").split(ESCALATE_REPLY).join("")); }
export const PROMISE_PROMPT = `【硬規則】你不是本人，不能替本人承諾或答應任何事：不要用第一人稱說之後會做什麼（我會、我再、我來、我幫你、我改、我調、我處理、下次我），不要保證、答應、約時間、談付錢或匯款。需要本人決定或行動的事，整個回答只寫「${ESCALATE_REPLY}」。可以給一般建議（「你可以…」「建議…」）。`;

// ── 小助手回覆標記 ─────────────────────────────────────────────
export const AGENT_LABEL = "（AI代理）";
/** 去掉舊的「自動回覆」字樣與重複標記，結尾加上一個（AI代理）。 */
export function labelReply(text, label = AGENT_LABEL) {
  const body = String(text ?? "").replace(/\s*[（(]\s*(自動回覆|AI\s*代理)\s*[）)]/gi, "").replace(/自動回覆/g, "").trim();
  return `${body}${label}`;
}
