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
