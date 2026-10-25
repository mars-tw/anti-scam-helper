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
  // 只有「網址」一個特徵、分數 1 的訊息：只記錄不通知（至少要分數 ≥ 2 或兩個特徵）。
  if (bothScam && (link === true || names.some((name) => LINK_RULES.has(name))) && (score >= 2 || names.length >= 2)) return "notice";
  return "none";
}

// 看圖模型判 SCAM 時，理由裡要有「具體的引流或要錢訊號」才算數；
// 只看到軟體畫面、用量上限、官方公告、技術說明、電影截圖這類，就降為不採計（只記錄，不當成詐騙）。
const VISION_CONCRETE = /QR|二維碼|條碼|加.{0,4}(LINE|line|賴|好友|群)|LINE\s*ID|ID\s*[:：]|網址|連結|http|www\.|私訊|聯繫|聯絡|匯款|轉帳|入金|出金|帶單|保證(獲利|賺)|穩賺|投資群|老師|飆股|娛樂城|博弈|百家樂|中獎|領取|兼職|日領|刷單任務|貸款|裸|色情|約炮|援交|外送茶/i;
const VISION_BENIGN = /介面|畫面|截圖.{0,6}(軟體|程式|設定|後台)|用量|上限|額度|重置|官方公告|公告|robots|文件|程式碼|終端機|指令|設定|電影|迷因|新聞|模型名稱|token\s*價格|主機|伺服器|部署/i;

// 矛盾檢查：理由自己說「沒有 QR／LINE ID／網址／引流／要錢」卻判 SCAM（地端小模型常見）。
// 把否定的那一段（到標點為止）拿掉後，若已沒有具體訊號 → 只算 UNSURE（只記錄、不通知）。
const VISION_DENIAL = /(?:未見|未發現|未出現|未包含|並未|沒有|沒看到|無任何|無|不含|並非|不是|非)[^，。；,.;！!？?]{0,40}/g;
const VISION_DENIED = /QR|二維碼|LINE|ID|網址|連結|引流|要錢|匯款|轉帳|入金|加好友|加群|聯繫|聯絡|詐騙/i;
export function visionContradicts(reason) {
  const r = String(reason ?? "");
  const denials = r.match(VISION_DENIAL)?.filter((d) => VISION_DENIED.test(d)) ?? [];
  if (!denials.length) return false;
  let rest = r;
  for (const d of denials) rest = rest.replace(d, " ");
  return !visionCounts(rest);
}
/** 看圖模型判定的最終值：SCAM 但理由自相矛盾 → UNSURE；SCAM 但沒有具體訊號 → SCAM_WEAK。 */
export function visionVerdict(verdict, reason) {
  if (verdict !== "SCAM") return verdict;
  if (visionContradicts(reason)) return "UNSURE";
  return visionCounts(reason) ? "SCAM" : "SCAM_WEAK";
}

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
/** 踢人現況的一句話（依執行中設定與發問所在的群）：只警告的群、一般踢人、冒名＋邀請／QR、購物再犯。 */
export const WARN_ONLY_STATUS = "本群目前暫時只發警告通知、請管理員確認，不會踢人，也不會刪訊息；其他群維持原本的規則。";
export function kickStatusText({ kickMode = "kick", kickWithInvite = false, kickRepeatShop = false, warnOnly = false } = {}) {
  if (warnOnly) return WARN_ONLY_STATUS;
  if (kickMode !== "notify") return "確認是詐騙的帳號，守衛可能會把對方移出社群，並先發通知說明。";
  const on = [
    kickWithInvite ? "冒用管理員名字又貼外部群組邀請連結或 QR code 的帳號" : "",
    kickRepeatShop ? "30 天內再貼一頁式詐騙購物連結的帳號" : "",
  ].filter(Boolean);
  return on.length
    ? `一般詐騙訊息的踢人功能目前暫停，只通知管理員；但${on.join("，以及")}，仍會直接被移出（管理員和受保護的成員不會）。`
    : "踢人功能目前暫停，只通知管理員。";
}

export function buildGuardFacts({ kickMode = "kick", kickWithInvite = false, kickRepeatShop = false, warnOnly = false, deleteOnLink = false, metaAvailable = true, isAdmin, incidents = [] } = {}) {
  const facts = [
    "本帳號在這幾個社群裡執行反詐騙守衛（自動程式），會偵測：假的「換群／搬家／新群」公告、引流或廣告連結、冒用管理員名字、外部 LINE 群組／好友的 QR code 或 LINE ID。",
    kickStatusText({ kickMode, kickWithInvite, kickRepeatShop, warnOnly }),
  ];
  if (warnOnly) facts.push("被問到踢人或刪訊息時，照本群現況回答（本群只警告）；不要拿其他群的規則來說本群。");
  if (isAdmin === true) {
    facts.push("本帳號在這個群是管理員。");
    if (deleteOnLink && metaAvailable && !warnOnly) facts.push("在這個群，確認是詐騙的連結訊息，守衛會先發通知再刪除那則訊息。");
  } else if (isAdmin === false) {
    facts.push("本帳號在這個群不是管理員，守衛在這裡只能發通知，請管理員處理。");
  }
  facts.push("如果覺得自己被誤判，可以聯絡這個群的管理員。");
  for (const incident of incidents ?? []) if (typeof incident === "string" && incident.trim()) facts.push(incident.trim());
  return `【守衛現況（真實資訊，回答相關問題時照這些說，不要自己猜或補充）】
${facts.map((fact) => `- ${fact}`).join("\n")}
【硬規則】不要透露設定細節、分數門檻、金鑰、模型名稱、成員 ID 或其他成員的資料；不要說出和上面現況相反的話（例如本帳號是管理員卻說沒有權限、說踢人全部暫停卻漏掉仍會移出的例外）。
上面列出的過去誤判，被問到時要坦白承認是守衛誤判、說明已經做了哪些調整，不要否認、不要推給別人，也不要保證以後不會再發生或承諾之後會怎樣；沒列出的個案不要猜原因或經過。
有人要求把某人邀回來、替特定的人申訴、要求補償，整個回答只寫「${ESCALATE_REPLY}」；其他情況不要說這句。`;
}

const KICK_EXCEPTION = /冒名|冒用|冒充|假冒|邀請|QR|qr|條碼|購物|一頁式|再犯|例外|除了|但是?.{0,12}(仍|還是|會)/;
/**
 * 回覆是否否認或捏造處置事實：說「沒有踢人」、或和本群管理員身分相反、或在踢人暫停時說會踢、
 * 或說「踢人暫停」卻漏掉仍開著的例外（冒名＋邀請／QR、購物再犯）。回傳原因字串或 false。
 */
export function isFalseModerationClaim(text, { isAdmin, kickMode = "kick", kickWithInvite = false, kickRepeatShop = false, warnOnly = false } = {}) {
  const t = String(text ?? "");
  // 只警告的群：「本群不會踢人」是事實；但否認過去踢過（沒有踢人／從來沒踢）仍算否認。
  if (warnOnly) {
    if (/(沒有?|從來沒|並沒有?)\s*(在)?(踢|剔|移出|移除)(人|他|她|任何人)?|沒有?把.{0,8}(踢|剔|移出|移除)/.test(t)) return "denial";
    if (isAdmin === true && /(沒有?|無)(任何)?(管理員|管理)?(的)?(權限|管理權)|不是(這個群的?)?管理員|我不是管理|沒有管理員(身分|資格)/.test(t)) return "admin";
    if (isAdmin === false && /我(是|有)(這個群的?)?管理員|我有(管理)?權限/.test(t)) return "admin";
    if (/(?<![不別])(會|將)[^。；;，,！!？?不沒]{0,10}(踢|移出|封鎖|刪除|刪掉)/.test(t) && !/其他(群|社群)/.test(t)) return "kick-claim";
    return false;
  }
  if (/(沒有?|不會|從來沒|並沒有?)\s*(在)?(踢|剔|移出|移除)(人|他|她|任何人)?|沒有?把.{0,8}(踢|剔|移出|移除)/.test(t)) return "denial";
  if (isAdmin === true && /(沒有?|無)(任何)?(管理員|管理)?(的)?(權限|管理權)|不是(這個群的?)?管理員|我不是管理|沒有管理員(身分|資格)/.test(t)) return "admin";
  if (isAdmin === false && /我(是|有)(這個群的?)?管理員|我有(管理)?權限/.test(t)) return "admin";
  if (kickMode === "notify") {
    const exceptionsOn = kickWithInvite || kickRepeatShop;
    const saysKick = /(會|將|已經?)(會)?(直接|執行|進行)?(把.{0,8})?(踢|移出|封鎖)(社群|群組|出去|除)?/.test(t) && !/暫停/.test(t);
    if (saysKick && !(exceptionsOn && KICK_EXCEPTION.test(t))) return "kick-claim";
    if (exceptionsOn && /(踢人|移出|踢除).{0,8}(暫停|關閉|停用|沒開)/.test(t) && !KICK_EXCEPTION.test(t)) return "kick-status";
  }
  return false;
}

// ── 閒聊／玩笑：短、切題、友善，不硬塞防詐提醒或處置說明 ─────────────────
const SERIOUS = /詐|騙|165|踢|剔|移出|移除|封鎖|檢舉|投資|匯款|轉帳|借錢|貸款|加賴|加\s*line|私訊|私聊|qr|條碼|連結|網址|帳號|密碼|驗證碼|獲利|老師|帶單|中獎|兼職|客服|退款|管理員|群主|權限|守衛|機器人|bot|刪|邀|申訴|補償|錢|付款|https?:|www\.|冒|發生|怎麼了|什麼事|剛剛|剛才|昨天|昨晚|為什麼|為何|誰/i;
/** 問句是不是單純閒聊／玩笑（短、沒有連結／金錢／詐騙／處置相關字眼）。 */
export function isCasual(text) {
  const t = String(text ?? "").normalize("NFKC").replace(/@\S+/g, "").trim();
  if (!t || t.length > 60) return false;
  return !SERIOUS.test(t) && !hasScamSignal(t);
}
export const CASUAL_PROMPT = `【這則是閒聊或玩笑】用一到兩句輕鬆、友善、切題的話回應對方說的內容（可以接梗、自嘲或簡短回答），不要提詐騙、165、查證、踢人、移出、封鎖、檢舉，也不要說「${ESCALATE_REPLY}」或「這要等本人回覆」。`;
const CASUAL_BANNED = /詐|騙|165|踢|移出|封鎖|檢舉|轉給本人|本人處理|等本人|親自回覆|守衛|管理員/;
/** 閒聊回覆：去掉離題的防詐／處置句子；全部離題回空字串。 */
export function trimCasual(body) {
  const sentences = String(body ?? "").split(/(?<=[。！？!?\n])/);
  return sentences.filter((s) => !CASUAL_BANNED.test(s)).join("").trim();
}
/** 「轉給本人處理」只能是整段回答；夾在其他內容裡當結尾客套話就拿掉。 */
export function stripEscalateFiller(body) {
  const t = String(body ?? "");
  if (!t.includes(ESCALATE_REPLY) || t.replace(/[。.!！\s]/g, "") === ESCALATE_REPLY) return t;
  return t.split(/(?<=[。！？!?\n])/).filter((s) => !s.includes(ESCALATE_REPLY)).join("").trim();
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
// ── 自動回覆：不編造本人狀況、不亂解讀短回覆 ──────────────────────
export const NO_FABRICATION_PROMPT = `【硬規則】不要編造本人的個人狀況：本人現在在做什麼、職業、工作、開什麼店、人在哪裡、行程等，對話裡沒有明確寫到就說不知道（例如「這要問本人」），不要猜。也不要從暱稱推測本人的職業、店或身分（暱稱只是名字，不代表真的在做那行）。看不懂的短回覆（例如「6」「+1」「XD」，常是稱讚或附和）不要亂解讀成別的意思，看不懂就簡單回應或問對方意思。`;

export const PROMISE_PROMPT = `【硬規則】你不是本人，不能替本人承諾或答應任何事：不要用第一人稱說之後會做什麼（我會、我再、我來、我幫你、我改、我調、我處理、下次我），不要保證、答應、約時間、談付錢或匯款。需要本人決定或行動的事，整個回答只寫「${ESCALATE_REPLY}」。可以給一般建議（「你可以…」「建議…」）。`;

// ── 小助手回覆標記 ─────────────────────────────────────────────
export const AGENT_LABEL = "（AI代理）";
/** 去掉舊的「自動回覆」字樣與重複標記，結尾加上一個（AI代理）。 */
export function labelReply(text, label = AGENT_LABEL) {
  const body = String(text ?? "").replace(/\s*[（(]\s*(自動回覆|AI\s*代理)\s*[）)]/gi, "").replace(/自動回覆/g, "").trim();
  return `${body}${label}`;
}

// ── 通知要不要 @ 管理員 ───────────────────────────────────────
/** admins：Map(成員 id → { role })，只收帶管理身分的訊息學到的；本帳號在裡面且有身分＝能踢人。 */
export function selfIsChatAdmin(admins, isSelf) {
  for (const [id, admin] of admins ?? []) if (admin?.role && isSelf(id)) return true;
  return false;
}
/** 本帳號能踢人的群：通知只引用訊息，不再 @ 群主／管理員；其他群照舊。 */
export function mentionTargets(admins, selfCanKick) {
  return selfCanKick ? [] : admins;
}

/**
 * 這則是不是在回覆本人的訊息：回覆的訊息是本帳號發的（ownIds），或回覆對象的發言者是本人（senderOf 查最近訊息的發言者）。
 * 重開機後 ownIds 會清空，所以要靠 senderOf＋isSelf（存檔的本人成員 id）補上。
 */
export function replyTargetsSelf(message, { ownIds = new Set(), senderOf = () => undefined, isSelf = () => false } = {}) {
  if (!message?.replyTo) return false;
  if (ownIds.has(message.replyTo)) return true;
  const sender = senderOf(message.replyTo);
  return sender !== undefined && isSelf(message.channelId, sender);
}

/**
 * 本人是不是已經自己回了這則：本人在這則之後發的訊息（posts：{ at, replyTo, to: [成員 id] }）
 * 有回覆這則，或回覆／@ 了同一個人。
 */
export function ownerAnswered(message, posts = []) {
  const after = message?.createdAt ?? 0;
  return posts.some((post) => post.at > after && (post.replyTo === message.messageId || (message.senderId && post.to?.includes(message.senderId))));
}

// 社群名稱裡的品牌／群主名（例如「示範研究社 - 測試小隊長」的「測試小隊長」）：一般成員暱稱裝成這個，就是冒充群主。
// 只取正規化後 ≥4 字、不是「交流區1」「新手區」這類通用字的片段。
const GENERIC_SEGMENT = /^(交流|討論|聊天|公告|新手|閒聊|問答|主|副|官方)?(區|群|群組|社群|頻道)?\d*$|^(交流|討論|聊天|公告|新手|閒聊|問答)(區|群|群組|社群)\d*$/;
export function brandSegments(channelName, normalize) {
  const square = squareKey(channelName);
  const out = [];
  for (const part of square.split(/\s+[-–—|｜]\s+|[|｜—–]/)) {
    const raw = part.trim();
    const key = normalize(raw);
    if (key.length >= 4 && !GENERIC_SEGMENT.test(key) && !out.some((item) => item.key === key)) out.push({ name: raw, key });
  }
  return out;
}
/** 暱稱含社群品牌名（或幾乎一樣）→ 回傳品牌名；否則 undefined。nameKey 已正規化。 */
export function impersonatesBrand(nameKey, segments, looksLike) {
  for (const segment of segments ?? []) if (looksLike(nameKey, segment.key)) return segment.name;
  return undefined;
}

// ── 只學習的群（groupPolicies[聊天室 id].learnOnly = true）───────────────
// 只收訊息與記事本進本機去識別化參考資料；不判詐騙、不通知、不刪不踢、不看圖、不回 @、不跑 /ai整理，在該群不發任何東西。
/** 從 groupPolicies 取出只學習的聊天室 id。 */
export function learnOnlyChats(groupPolicies = {}) {
  return new Set(Object.entries(groupPolicies ?? {}).filter(([, policy]) => policy?.learnOnly === true).map(([chatId]) => chatId));
}
/** 會對聊天室產生動作（發送、刪除、收回、表情、踢人、抓圖、已讀、詐騙判斷）的請求；只學習的群一律擋下。讀歷史與記事本不擋。 */
export const LEARN_ONLY_BLOCKED_FRAMES = new Set(["message:send", "message:delete", "message:unsend", "message:react", "member:remove", "media:fetch", "chat:read", "scam:check"]);
export function blockedForLearnOnly(frame, chats, { mediaChats, sendChats } = {}) {
  if (!frame || !chats?.has(frame.chatId) || !LEARN_ONLY_BLOCKED_FRAMES.has(frame.type)) return false;
  // 延伸學習（learnExt）的只學習群：只放行「讀圖片」，發送、刪除、踢人等照擋。
  if (frame.type === "media:fetch" && mediaChats?.has(frame.chatId)) return false;
  // 機器人訓練群：只放行文字發送（@ 回覆與整理）；刪除、踢人、表情、判詐騙照擋。
  if (frame.type === "message:send" && sendChats?.has(frame.chatId)) return false;
  return true;
}
/** 只學習群裡另外開了延伸學習（討論串、圖片描述、學習筆記）的：groupPolicies[id] = { learnOnly: true, learnExt: true }。 */
export function learnExtChats(groupPolicies = {}) {
  return new Set(Object.entries(groupPolicies ?? {}).filter(([, policy]) => policy?.learnOnly === true && policy?.learnExt === true).map(([chatId]) => chatId));
}

/** 只學習群另開詐騙判斷＋通知（標記）：groupPolicies[id] = { learnOnly: true, scanNotify: true }。只判文字、只發通知；刪除、踢人、圖片警告照只學習全擋。 */
export function scanNotifyChats(groupPolicies = {}) {
  return new Set(Object.entries(groupPolicies ?? {}).filter(([, policy]) => policy?.learnOnly === true && policy?.scanNotify === true).map(([chatId]) => chatId));
}

// ── 只警告的群（groupPolicies[聊天室 id].warnOnly = true）────────────────
// 所有情況（含冒名、冒名＋邀請、再犯、購物詐騙、詐騙連結）都不踢、不刪，只發警告通知；通知要不要 @管理員照原規則。
export function warnOnlyChats(groupPolicies = {}) {
  return new Set(Object.entries(groupPolicies ?? {}).filter(([, policy]) => policy?.warnOnly === true).map(([chatId]) => chatId));
}
/** 只警告的群：踢人與刪訊息的請求一律擋（發通知照常）。 */
export const WARN_ONLY_BLOCKED_FRAMES = new Set(["member:remove", "message:delete"]);
export function blockedForWarnOnly(frame, chats) {
  return Boolean(frame && chats?.has(frame.chatId) && WARN_ONLY_BLOCKED_FRAMES.has(frame.type));
}

// ── 機器人群回覆頻率限制（groupPolicies[聊天室 id].replyLimits）──────────
// 群裡都是機器人時防互相無限回覆：每個發話者、整個群各有每分鐘上限；只回明確 @ 本帳號的訊息。
// 預設：每個發話者每分鐘 1 則、整個群每分鐘 3 則。尚未接上主流程（之後開放回覆時才用）。
export const DEFAULT_REPLY_LIMITS = Object.freeze({ perSenderPerMinute: 1, perChatPerMinute: 3, implicitSenderSeconds: 180 });
export function makeChatReplyLimiter(limits = {}, { now = () => Date.now() } = {}) {
  const perSender = Math.max(0, Number(limits.perSenderPerMinute ?? DEFAULT_REPLY_LIMITS.perSenderPerMinute) || 0);
  const perChat = Math.max(0, Number(limits.perChatPerMinute ?? DEFAULT_REPLY_LIMITS.perChatPerMinute) || 0);
  // 沒有 @、只是叫名字或回覆本帳號的訊息（implicit）：同一人 implicitSenderSeconds 秒內只算一次，防機器人互相回覆停不下來。
  const implicitMs = Math.max(0, Number(limits.implicitSenderSeconds ?? DEFAULT_REPLY_LIMITS.implicitSenderSeconds) || 0) * 1000;
  const chats = new Map(); // chatId → [{ at, senderId }]
  const implicitAt = new Map(); // `${chatId} ${senderId}` → 上次 implicit 觸發時間
  return {
    /** 要回覆前呼叫：沒有明確 @ 本帳號、或超過上限 → { ok: false, reason }；允許時會記下這次。 */
    allow(chatId, senderId, { mentionedSelf = false, implicit = false } = {}) {
      if (!mentionedSelf) return { ok: false, reason: "not-mentioned" };
      const t = now();
      const list = (chats.get(chatId) ?? []).filter((item) => t - item.at < 60_000);
      chats.set(chatId, list);
      if (list.length >= perChat) return { ok: false, reason: "chat-rate" };
      if (list.filter((item) => item.senderId === senderId).length >= perSender) return { ok: false, reason: "sender-rate" };
      const key = `${chatId} ${senderId}`;
      if (implicit && t - (implicitAt.get(key) ?? -Infinity) < implicitMs) return { ok: false, reason: "implicit-sender-rate" };
      if (implicit) implicitAt.set(key, t);
      list.push({ at: t, senderId });
      return { ok: true };
    },
  };
}

// ── @ 回覆的進階規則（從學習筆記整理）─────────────────────────────
// 加在人設（chat.systemPrompt）後面；人設、第三人稱提主人、不編造主人的事等硬規則照舊優先。
export function replyGuidelines({ maxChars = 300 } = {}) {
  return [
    "【回覆規則】",
    `- 長度：一般兩到三句，最多 ${maxChars} 字；被要求說明或整理才多講，也不要超過上限。`,
    "- 先確認對方是在叫你（@ 你、回覆你、直接叫名字）才回；看不出在叫誰、或問題不清楚時，只簡短問一句「是在問我嗎？想問哪個部分？」。",
    "- 自稱前後一致，只用自己的身分說話；不替別人、主人或其他機器人回答，也不說自己是別人。",
    "- 閒聊（吃飽沒、在不在、打招呼）一句輕鬆回應就好，再把話題帶回對方想聊的事或你能幫的事。",
    "- 技術問題：先確認對方用的平台、工具或版本再給步驟；群裡最近已經有人答過，就引用那個重點，不要重講一套通用流程。",
    "- 直接給內容或直接提問，不要說「我幫你／我來／我會／我先」這類承諾或預告的句子。",
    "- 同樣的問題剛問過、答過：簡短帶過重點，不要整段重複。",
    "- 提到非官方工具或做法（例如非官方 LINE 機器人、雙開、模擬登入）：提醒可能違反服務條款、帳號有被限制的風險。",
    "- 投資、槓桿、合約、加倉、攤平、套牢：提醒停損與清算風險；不給具體買賣指令（買、賣、加倉、關單、價位），只說判斷條件；不確定就說不確定。",
    "- 收益截圖、邀請碼、推薦連結、帶單：一律說是推廣內容、未經驗證，不背書、不轉傳。",
    "- 提到收益率：補一句沒算回撤、手續費和清算風險。引用數據、價格、費率要說時間和來源；不知道就說不知道。",
  ].join("\n");
}

const RISK_ASK = /(槓桿|倍數|合約|永續|加倉|加碼|攤平|補倉|套牢|爆倉|清算|保證金|馬丁|梭哈|all\s*in|\d+\s*[xX倍])/;
const RISK_SAID = /(停損|止損|清算|爆倉)/;
const PROMO_ASK = /(收益截圖|收益卡|獲利截圖|曬單|邀請碼|推薦碼|邀請連結|推薦連結|帶單|跟單|返佣|註冊連結|\+\d{2,4}(\.\d+)?\s*%)/;
const PROMO_SAID = /推廣|未經驗證/;
/** 問到槓桿／加倉／套牢而回覆沒提停損或清算風險：回傳要補的一句；不用補回 undefined。 */
export function riskNote(ask, reply) {
  if (!RISK_ASK.test(String(ask ?? "")) || RISK_SAID.test(String(reply ?? ""))) return undefined;
  return "提醒一下：先設好停損，槓桿越高越容易被清算，要不要加倉請依自己的條件判斷。";
}
/** 提到收益截圖、邀請碼、帶單而回覆沒標推廣：回傳要補的一句；不用補回 undefined。 */
export function promoNote(ask, reply) {
  if (!PROMO_ASK.test(String(ask ?? "")) || PROMO_SAID.test(String(reply ?? ""))) return undefined;
  return "這類收益截圖或邀請碼屬於推廣內容、未經驗證，不代表推薦。";
}

// ── 機器人訓練群（只學習群另開 @ 回覆／整理）───────────────────────
// groupPolicies[id] = { learnOnly: true, allowReply: true, allowSummary: true, replyLimits: { perSenderPerMinute, perChatPerMinute } }
// 判詐騙、通知、刪除、踢人、圖片警告仍全關；只放行回覆與整理的發送。
export function botCampChats(groupPolicies = {}) {
  const out = new Map();
  for (const [chatId, p] of Object.entries(groupPolicies ?? {})) {
    if (p?.learnOnly !== true || (p.allowReply !== true && p.allowSummary !== true)) continue;
    out.set(chatId, { reply: p.allowReply === true, summary: p.allowSummary === true, limits: { ...DEFAULT_REPLY_LIMITS, ...(p.replyLimits ?? {}) }, callNames: Array.isArray(p.callNames) ? p.callNames.map((n) => String(n ?? "").trim()).filter(Boolean) : [] });
  }
  return out;
}

/** 解析看圖稽核的回覆：第一行判定、第二行證據、其餘是描述。 */
export function parseAuditImage(answer) {
  const lines = String(answer ?? "").trim().split(/\n+/);
  let verdict = ["SCAM", "UNSURE", "OK"].find((word) => lines[0]?.trim().toUpperCase().startsWith(word));
  const reason = (lines[1] ?? lines[0]?.replace(/^(SCAM|UNSURE|OK)\W*/i, "") ?? "").trim().slice(0, 60);
  verdict = visionVerdict(verdict, reason);
  return { verdict, reason, desc: lines.slice(2).join("\n") };
}

// 圖片版假搬家公告：「新群重新審核」「請原成員轉移到新群」。沒有 QR 也要通知（只通知，不刪不踢）。
const FAKE_GROUP_IMAGE = /(轉移|移轉|移動|遷移|搬|換)(到|至)?(新|另一?個|備用)(群|社群|群組)|新(群|社群|群組).{0,8}(審核|加入|申請)|(加入|申請|進入)新(群|社群|群組)|假搬家|假群組/;
export function isFakeGroupImage(reason) {
  return FAKE_GROUP_IMAGE.test(String(reason ?? ""));
}

/** 每群踢人模式：groupPolicies[id].kickMode = "kick" 才在全域 notify 時對該群開真的刪＋踢；其他值一律跟全域。只學習／只警告群不受覆寫影響。 */
export function kickModeFor(chatId, { globalMode = "notify", groupPolicies = {} } = {}) {
  const p = groupPolicies?.[chatId];
  if (!p || p.learnOnly === true || p.warnOnly === true) return globalMode;
  return p.kickMode === "kick" ? "kick" : globalMode;
}

/**
 * 開踢人的群（groupPolicies[id].kickMode = "kick"）專用判定，維護者 10/22 定的條件：
 * 規則分數 ≥ strongScore 且第一層 Claude（claude-*，A→B）判 SCAM 才考慮踢；
 * Meta 覆核：SCAM → 踢；沒回應／逾時／錯誤（undefined）→ 無視、照踢；明確 OK 或 UNSURE → 只通知；
 * 第一層不是 Claude（Claude 兩組都失敗、改由 Grok 或 Meta 當第一層）→ 只通知。
 * 覆核由 Grok 回答時規則同 Meta：SCAM 踢、沒回應照踢、OK／UNSURE 只通知（覆核鏈：Grok → Meta）。
 * 不符合前提（分數不夠、第一層沒判 SCAM）回 undefined，交回一般流程。
 */
export function decideChatKick({ score, strongScore = 6, verdict, model, review, expandedInvite = false, ordinaryMember = false }) {
  // 維護者 10/24 08:41：踢人群裡短網址展開確認是 LINE 群組邀請、一般成員發、覆核判 SCAM → 刪文＋踢人（第一層 UNSURE／SCAM 皆可）。
  // 展開失敗（呼叫端不會傳 expandedInvite）、覆核失敗／逾時／空白、覆核非 SCAM、第一層明確 OK → 不走這條。
  if (expandedInvite && ordinaryMember && review === "SCAM" && (verdict === "UNSURE" || verdict === "SCAM")) return "kick";
  if (!(score >= strongScore) || verdict !== "SCAM") return undefined;
  if (!/^claude/i.test(String(model ?? ""))) return "notice";
  if (review === "SCAM" || review === undefined || review === "UNAVAILABLE") return "kick";
  return "notice";
}

/** 錯誤分類碼（只看錯誤摘要，不含秘密與訊息原文）：給每日稽核統計用。 */
export function errorCode(kind, detail) {
  const d = String(detail ?? "");
  const m = d.match(/\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE)\b/);
  if (m) return m[1];
  if (/HTTP_?(\d{3})/.test(d)) return `HTTP_${d.match(/HTTP_?(\d{3})/)[1]}`;
  const code = d.match(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/);
  if (code) return code[1];
  if (/empty-or-unusable/i.test(d)) return "MODEL_EMPTY";
  if (/abort|timeout|timed out/i.test(d)) return "TIMEOUT";
  if (/\bAUTH\b|401|403|unauthori[sz]ed/i.test(d)) return "AUTH";
  if (/\bTIMEOUT\b/.test(d)) return "TIMEOUT";
  return `${String(kind ?? "unknown").toUpperCase()}_OTHER`;
}
/** 派網群紅包／QR 例外不適用：跟單、帶單搭配 QR（掃碼）或短網址。 */
export function redPacketExceptionBlocked(text, { shortener = /(?!)/, qr = false } = {}) {
  const t = String(text ?? "");
  if (!/跟單|帶單/.test(t)) return false;
  return qr || /QR|掃碼|掃描|二維碼/i.test(t) || shortener.test(t);
}

/** 紀錄是否代表「發言者被判詐騙／可疑」。只記錄的看圖結果（UNSURE／SCAM_WEAK／OK）不算，免得一般看盤或獲利截圖被當成標記。 */
export function isFlagEntry(entry, flagActions) {
  const action = entry?.action ?? "";
  if (!flagActions.test(action)) return false;
  if (action === "vision-flag") return entry.verdict === "VISION_SCAM" || (entry.scanNotify === true && entry.notified !== false);
  return true;
}

// 看圖單一模型判 SCAM 的通知門檻（維護者 10/25）：圖片理由／QR 裡沒有具體連結訊號（網址、短網址、群組邀請、QR、LINE ID／加好友），
// 又沒有覆核模型確認 SCAM → 只記錄、不在群內通知。按鈕字樣、「連結」這種泛稱不算連結。
const VISION_LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|cc|me|tw|xyz|top|vip|app|link|ly|gl|gd|to|co|info|shop|site|online)\b|短網址|縮網址|網址|QR|二維碼|條碼|掃碼|掃描|LINE\s*ID|ID\s*[:：]|加.{0,4}(LINE|line|賴|好友|群)|line\.me|群組?邀請|邀請連結|邀請碼|Telegram|t\.me|WhatsApp/i;
export function visionHasLink(reason, { qr = false } = {}) {
  return qr === true || VISION_LINK.test(String(reason ?? ""));
}
/** 單一看圖模型判 SCAM 是否可以在群內通知：有連結訊號，或覆核模型也判 SCAM。 */
export function visionSoloMayNotify({ reason, qr = false, review } = {}) {
  return visionHasLink(reason, { qr }) || review === "SCAM";
}

/**
 * 10/25：其他防詐機器人發的「疑似詐騙提醒」（標題＋詐騙機率／訊息 ID／並非事實判定這類固定欄位，常一次 @ 一大串成員）。
 * 依內容判斷，不靠成員 ID，所以同類的其他機器人也涵蓋。守衛對它不回覆、不回收到／處置、不通知、不計標記、不學習。
 */
export function isAntiScamBotAlert(text) {
  const t = String(text ?? "").normalize("NFKC").replace(/[\s\u200b]+/g, "");
  if (!/疑似詐騙(提醒|警示|通知|訊息)|詐騙警示|防詐提醒/.test(t)) return false;
  const markers = [/詐騙機率[:：]?\d/, /訊息ID[:：]?\d/, /並非事實判定/, /手法信心度/, /請管理員查證/, /手法[:：]/].filter((re) => re.test(t)).length;
  return markers >= 2;
}
