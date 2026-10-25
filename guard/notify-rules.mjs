import { isAntiScamBotAlert } from "./policy.mjs";
const INVITE_RE = /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\/|line\.me\/(?:R\/)?square\//i;
export const CROSS_INVITE = "同群組邀請跨群出現";
/** 踢人群（per-chat kickMode:kick，維護者 10/22 15:51）可刪踢的通知層理由；其他群一律只通知。 */
export const MINER_KICKABLE = new Set([CROSS_INVITE, "冒充負責人問帳戶／指定匯款", "同群多個帳號頭像相同", "同群多個帳號暱稱相同且像真管理員"]);
/** 踢人群刪踢判斷：沿用 decideChatKick 規則（Claude 判 SCAM；覆核 SCAM／空／逾時→踢；OK／UNSURE→通知；非 Claude→通知）。 */
export function minerAction({ perChatKick, reasons = [], verdict, model, review, protectedMember }) {
  if (!perChatKick || protectedMember || !reasons.some((r) => MINER_KICKABLE.has(r))) return "notice";
  if (verdict !== "SCAM" || !/^claude/i.test(String(model ?? ""))) return "notice";
  return review === "SCAM" || review === undefined || review === "UNAVAILABLE" || review === "TIMEOUT" ? "kick" : "notice";
}
// 通知層（10/22 誤判審查／情資分析）：只決定「要不要通知管理員」，分數只算通知分，絕不計入踢人分數，也不刪文。
import { createHash } from "node:crypto";
import { ANTI_SCAM_WARNING, MAINSTREAM_CONTENT_DOMAINS, PLATFORM_SHORTENERS, SHORTENERS as RULE_SHORTENERS } from "./rules.mjs";

const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
const INVEST = /投資|帶單|跟單|老師|獲利|報酬|收益|配息|股票|虛擬貨幣|幣圈|合約|USDT|期貨|黃金/i;

/** 通知分規則（e／f／g）。f 直接通知；e、g 各 +2，e 跟投資字眼一起再 +2。 */
export const WORK_MONEY = "工作指示要匯款／問帳戶餘額";
export const FAKE_VERIFY = "假認證／運費＋加 LINE";
export const WITHDRAW_FEE = "出金要先繳費＋聯絡方式";
export const CODE_COUPON = "領券／贈品要回傳驗證碼";
export const NOTIFY_RULES = [
  { name: "福利／簽到／贈品／合資話術", score: 2, investBonus: 2, pattern: /福利群|每日簽到|免費(?:贈品|送|領).{0,12}(?:加|line|LINE|賴)|合資|每月配息|月月配息|黃金(?:交付|交割)|繳(?:稅金|保證金).{0,8}(?:領回|出金|提領)/ },
  { name: "冒充負責人問帳戶／指定匯款", score: 4, direct: true, pattern: /(?:帳戶|戶頭).{0,6}餘額|匯(?:款|錢)?到.{0,6}(?:指定|這個|以下).{0,4}(?:帳戶|帳號)|指定帳戶|匯款單.{0,6}(?:拍照|拍給|截圖)|(?:拍|傳).{0,4}匯款單/ },
  { name: "+1／抓圖／先付運費話術", score: 2, pattern: /[+＋]\s*1.{0,10}(?:加我|私訊|line|LINE|賴)|抓圖給我|先付運費|運費先付/ },
  // 10/23 自動反思：收購門號／SIM 卡（人頭門號）話術被兩個模型判詐卻因規則只有 2 分沒通知。只通知，不進踢人分數。
  // 要同時有「收購＋門號／卡」和「付款／卡商／私下聯絡」字眼，避免一般電信討論誤報。
  { name: "收購門號／SIM 卡（人頭門號）", score: 4, direct: true, pattern: /^(?=[\s\S]*(?:(?:收購|高價收|回收|收)(?:各大|各家)?\s*(?:電信)?\s*(?:門號|預付卡|SIM\s*卡|實體卡|易付卡|月租卡|電信卡|人頭卡|月租\s*[|｜/、])|(?:收購|高價收|收)(?:各大|各家)\s*電信))(?=[\s\S]*(?:結款|結帳|付款|付現|現金|高價|卡商|工作室|line|賴|私訊|私我|密我))/i },
  // 10/23 自動反思：仿 LINE 官方「已被邀請加入…請點選以下連結加入社群」文字，連結卻不是 line.me。只通知。
  { name: "仿 LINE 社群邀請文字但連結不是 LINE", score: 4, direct: true, pattern: /^(?=[\s\S]*(?:已\s*被\s*邀\s*請\s*加\s*入|點\s*選\s*以\s*下\s*連\s*結\s*加\s*入\s*社\s*群))(?=[\s\S]*(?:https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}\/))(?![\s\S]*line\.me\/)/i },
  // 10/23 晨會：假投票／假活動騙手機號碼與 LINE 認證碼。只通知，不進踢人分數。
  // 要有投票字眼，再加「非主流平台的外部連結」或「叫人輸入認證碼／驗證碼／手機號碼」；正常投票討論、YouTube／b23.tv 等官方網址不單獨觸發。
  { name: "假投票／活動騙認證碼", score: 4, direct: true, match: (t) => VOTE.test(t) && (ASK_CODE.test(t) || (t.match(URL_RE) ?? []).some((u) => !isMainstreamMediaHost(hostOf(u)) && !OFFICIAL_HOST.test(hostOf(u)))) },
  // 10/23 晨會：假管理員「群裡有機器人洗版／開新群／搬群」話術。只通知（踢人分數仍只看 rules.mjs 的假群組公告）。
  // 10/24 自動反思：群友的防詐提醒文字（「疑似詐騙提醒…不要加入新群」）被這條觸發、兩個模型都判 OK 仍通知。
  // 沒有任何網址／邀請時，若文字是防詐提醒語氣，或第一層與覆核都判 OK，就不算（只會更少通知）。
  { name: "假管理員搬群話術", score: 4, direct: true, match: (t, ctx = {}) => MOVE_GROUP.test(t) && !(!hasLinkOrInvite(t) && (ANTI_SCAM_WARNING.test(t) || (ctx.verdict === "OK" && ctx.review === "OK"))) },
  // 10/24 情資：工作指示口吻要匯款／問帳戶餘額（假老闆、假主管）。只通知，不進踢人分數，不在 MINER_KICKABLE。
  // 白名單／管理員／受保護成員發的不算；防詐提醒語氣不算。
  { name: WORK_MONEY, score: 4, direct: true, match: (t, ctx = {}) => !ctx.protectedSender && WORK_MONEY_RE.test(t) && WORK_TONE.test(t) && !ANTI_SCAM_WARNING.test(t) },
  // 10/24 情資：假金流認證／實名認證／帳戶驗證失敗／支付運費＋叫人加 LINE／私訊；免費餐券、合資訂單要配加群／加 LINE 才算。只通知。
  { name: FAKE_VERIFY, score: 4, direct: true, match: (t, ctx = {}) => !ctx.protectedSender && !ANTI_SCAM_WARNING.test(t) && ((FAKE_VERIFY_RE.test(t) && ADD_LINE.test(t)) || (FREE_LURE.test(t) && (ADD_LINE.test(t) || JOIN_GROUP.test(t)))) },
  // 10/24 情資：出金要先繳／補繳保證金、稅金、解凍費，再加網址／QR／私訊／加 LINE。只通知。
  { name: WITHDRAW_FEE, score: 4, direct: true, match: (t, ctx = {}) => !ctx.protectedSender && !ANTI_SCAM_WARNING.test(t) && /出金/.test(t) && WITHDRAW_FEE_RE.test(t) && (hasLinkOrInvite(t) || /QR|ＱＲ|條碼/i.test(t) || ADD_LINE.test(t)) },
  // 10/24 情資：領券／折價券／送東西要人回傳驗證碼。假投票規則已命中時不重複。只通知。
  { name: CODE_COUPON, score: 4, direct: true, match: (t, ctx = {}) => !ctx.protectedSender && !ANTI_SCAM_WARNING.test(t) && SEND_CODE.test(t) && COUPON.test(t) && !(VOTE.test(t) && ASK_CODE.test(t)) },
];

const WORK_MONEY_RE = /(?:帳戶|戶頭)\s*(?:的\s*)?餘額|(?:匯|轉)(?:款|錢)?\s*(?:到|至)\s*.{0,6}指定(?:的)?\s*(?:帳戶|帳號)/;
const WORK_TONE = /幫我|馬上|立刻|立即|今天先|先幫|先匯|先轉|老闆(?:交代|說|要|吩咐)|主管(?:交代|說|要)|趕快|盡快|急/;
const FAKE_VERIFY_RE = /金流認證|實名制?\s*認證|帳戶驗證失敗|支付運費/;
const ADD_LINE = /加\s*(?:我\s*)?(?:的\s*)?(?:LINE|line|ＬＩＮＥ|賴)|私訊|加\s*(?:我\s*)?好友/;
const JOIN_GROUP = /(?:加入|進|入)\s*.{0,6}群|群組邀請/;
const FREE_LURE = /免費餐券|合資訂單/;
const WITHDRAW_FEE_RE = /(?:先|補)\s*繳?\s*(?:保證金|稅金|解凍費)|繳\s*(?:解凍費)/;
const SEND_CODE = /回傳\s*(?:簡訊)?\s*驗證碼|(?:傳|給)\s*(?:簡訊)?\s*驗證碼\s*給我|驗證碼\s*(?:傳|給|回傳)\s*(?:給)?\s*我/;
const COUPON = /領券|折價券|優惠券|送/;
const MOVE_GROUP = /(?:機器人|廣告|外掛).{0,6}(?:洗版|洗頻|刷屏)|開(?:了)?新群|搬群|換新群|移到新群|加入新群/;
function hasLinkOrInvite(t) { return INVITE_RE.test(t) || (String(t).match(URL_RE) ?? []).length > 0; }
const VOTE = /投票|票選|比賽|幫.{0,4}投(?:票|一票|一下|給)|拉票/;
const ASK_CODE = /(?:輸入|填(?:寫|入)?|提供|傳|給|回覆|告訴).{0,8}(?:認證碼|驗證碼|手機號碼|手機號|門號|簡訊碼)|(?:認證碼|驗證碼|簡訊碼).{0,6}(?:給我|傳給|回傳|截圖|告訴)/;
const OFFICIAL_HOST = /(?:^|\.)(?:gov\.tw|edu\.tw|line\.me|google\.com|forms\.gle)$/i;
function hostOf(u) { return (String(u).replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase(); }

/** 通知文字的補充教學（只加說明，不改處置）。 */
export function noticeTips(names = []) {
  const tips = [];
  if (names.some((n) => n === "假管理員搬群話術" || n === "假群組公告")) tips.push("真管理員的皇冠是 LINE 介面在名字旁的標示，畫在頭像圖裡的皇冠不算；社群不會叫大家搬到新群，這類是假群組。");
  if (names.includes("假投票／活動騙認證碼")) tips.push("投票不需要輸入手機號碼或 LINE 認證碼，輸入了帳號可能被盜。");
  if (names.includes(WORK_MONEY)) tips.push("說要匯款或問帳戶餘額，請先打電話給本人確認（用你原本存的號碼，不要用訊息裡給的）。");
  if (names.includes(FAKE_VERIFY)) tips.push("銀行、賣場不會叫你加 LINE 做金流認證、實名認證或先付運費。");
  if (names.includes(WITHDRAW_FEE)) tips.push("正規平台出金不會要你先繳保證金、稅金或解凍費。");
  if (names.includes(CODE_COUPON)) tips.push("驗證碼不要給任何人，給了帳號可能被盜。");
  return tips;
}

export function notifyScore(text, ctx = {}) {
  const t = String(text ?? "");
  let score = 0; const names = []; let direct = false;
  for (const rule of NOTIFY_RULES) {
    if (!(rule.match ? rule.match(t, ctx) : rule.pattern.test(t))) continue;
    score += rule.score; names.push(rule.name);
    if (rule.investBonus && INVEST.test(t)) { score += rule.investBonus; names.push("話術＋投資字眼"); }
    if (rule.direct) direct = true;
  }
  return { score, names, notify: direct || score >= 2 };
}

const KNOWLEDGE = /(?:^|\.)(?:github\.com|gitlab\.com|youtube\.com|youtu\.be|medium\.com|wikipedia\.org|notion\.site|docs\.[a-z0-9-]+\.[a-z]+|readthedocs\.io|stackoverflow\.com|arxiv\.org|hackmd\.io|vocus\.cc|substack\.com|dev\.to|npmjs\.com|huggingface\.co)$/i;
const SHOP_HOST = /(?:^|\.)(?:shopee\.|momoshop\.|pchome\.|ruten\.|amazon\.|taobao\.|tmall\.|shopline\.|cyberbiz\.|91app\.|easystore\.)|shop|store|mall/i;
/** 網址類型：短網址／知識／購物／群組邀請／其他。 */
export function urlKind(url, { shorteners = [], shopping = false } = {}) {
  const u = String(url ?? "");
  if (/line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\//i.test(u)) return "群組邀請";
  const host = (u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase();
  if (shorteners.some((d) => host === d || host.endsWith(`.${d}`))) return "短網址";
  if (KNOWLEDGE.test(host)) return "知識";
  if (shopping || SHOP_HOST.test(host)) return "購物";
  return "其他";
}
export const firstUrl = (text) => String(text ?? "").match(URL_RE)?.[0];
export const isKnowledgeUrl = (url) => urlKind(url) === "知識";

/** 圖片通知（a／c／b 的單張判斷、1 的 UNSURE 例外）。回 { notify, names, profitOnly, loss }。 */
export function imageNotify(verdict, reason) {
  const r = String(reason ?? "");
  const hasUrl = /網址|網站|水印|浮水印|\.com|\.net|\.io|\.cc|連結|URL/i.test(r) && !/無(?:LINE|引流|網址|連結)|沒有(?:網址|連結)/i.test(r.replace(/無QR(?:碼|code)?/gi, ""));
  const hasQr = /QR/i.test(r) && !/無\s*QR|沒有\s*QR/i.test(r);
  const names = [];
  if (verdict === "SCAM") names.push("圖片判詐騙");
  if (/老師|直播|帶單|帶大家|跟單/.test(r) && hasUrl) names.push("老師直播／帶單獲利圖＋網址水印");
  const apy = Math.max(0, ...[...r.matchAll(/(?:年化|APY|APR)[^0-9+]{0,6}\+?([0-9][0-9,]*)\s*%/gi)].map((m) => Number(m[1].replace(/,/g, ""))));
  if ((apy >= 500 || /秒合約|猜漲跌|賭(?:價格|漲跌)/.test(r)) && (hasQr || hasUrl)) names.push("高年化／秒合約＋QR或網址");
  if (verdict === "UNSURE" && /多個.{0,6}(?:同頭像|同暱稱|帳號).{0,10}(?:冒充|假冒).{0,4}管理|冒充管理/.test(r)) names.push("多帳號冒充管理員");
  const loss = /虧損|賠|負報酬|-\d/.test(r) && !/獲利|盈利|\+\d/.test(r);
  const profitOnly = !names.length && !loss && /獲利|盈利|收益|報酬|\+[0-9]/.test(r);
  return { notify: names.length > 0, names, profitOnly, loss };
}

/** 依發訊者／內容雜湊的 24h 狀態（b、3 的 SCAM≥2、跨群同內容）。只在記憶體，不存檔。 */
export function makeNotifyTracker({ windowMs = 24 * 3_600_000, max = 5000 } = {}) {
  const profit = new Map(); // chat sender → [time]
  const scams = new Map();  // sender → [time]
  const hashes = new Map(); // hash → Map(chatId → time)
  const prune = (list, now) => list.filter((t) => now - t < windowMs);
  const cap = (map) => { if (map.size > max) map.delete(map.keys().next().value); };
  return {
    /** 純獲利截圖：回 true＝同一人 24h 內第 2 次以上。 */
    profitImage(chatId, senderId, now = Date.now()) {
      const key = `${chatId} ${senderId}`; const list = [...prune(profit.get(key) ?? [], now), now];
      profit.set(key, list); cap(profit); return list.length >= 2;
    },
    /** 最近 24h 貼過獲利截圖，現在接著貼網址或叫人私訊。 */
    followsProfit(chatId, senderId, text, now = Date.now()) {
      const list = prune(profit.get(`${chatId} ${senderId}`) ?? [], now);
      return list.length > 0 && (Boolean(firstUrl(text)) || /私訊|私聊|密我|加我|加賴|加line/i.test(String(text ?? "")));
    },
    /** 記一次 SCAM 判定：回 true＝同一發訊者 24h 內 ≥2 次。 */
    scam(senderId, now = Date.now()) {
      const list = [...prune(scams.get(senderId) ?? [], now), now];
      scams.set(senderId, list); cap(scams); return list.length >= 2;
    },
    /** 同內容雜湊跨群：回出現的群數。 */
    crossChat(text, chatId, now = Date.now()) {
      const norm = String(text ?? "").normalize("NFKC").replace(/\s+/g, "");
      if (norm.length < 8) return 1;
      const h = createHash("sha256").update(norm).digest("hex").slice(0, 16);
      const seen = hashes.get(h) ?? new Map();
      for (const [c, t] of seen) if (now - t >= windowMs) seen.delete(c);
      seen.set(chatId, now); hashes.set(h, seen); cap(hashes);
      return seen.size;
    },
  };
}

// 明確招攬投資（祈使／邀約語氣）：叫人入金／出金、帶你賺、保證獲利、招收跟單、報明牌給你。單純提到「入金」「帶單」不算。
const INVEST_SOLICIT = new RegExp([
  String.raw`(?:叫|請|讓|帶|教|幫)\s*(?:你|妳|您|大家|各位|你們|妳們|新手|朋友)?\s*(?:先|快|趕快|馬上|立即|一起)?\s*(?:去)?\s*(?:入金|儲值|出金)`,
  String.raw`(?<![我俺])(?<!我們)(?<!我也)(?<!我就)(?:先|快|趕快|馬上|立即|立刻|趕緊|一起|現在就?)\s*(?:去)?\s*(?:入金|儲值)(?!\s*[了嗎嘛吧？?])`,
  String.raw`(?:入金|儲值)\s*(?:就|即|立即|馬上)?\s*(?:送|贈|返|領|拿|翻倍|保證|穩賺|有獎|加碼)`,
  String.raw`(?:入金|儲值)\s*(?:\d+|[一二三五十百千萬]+)\s*(?:U|USDT|元|塊|萬)?\s*(?:起|以上|即可|就能|就可)`,
  String.raw`(?:最低|最少|只要|僅需)\s*(?:入金|儲值)`,
  String.raw`(?:找|私|密|加|聯繫|聯絡)\s*(?:我|老師|助理|客服).{0,8}(?:入金|出金|帶單|跟單)`,
  String.raw`(?:入金|出金|帶單|跟單).{0,8}(?:找|私|密|加|聯繫|聯絡)\s*(?:我|老師|助理|客服)`,
  String.raw`穩賺|保證\s*(?:獲利|賺|收益|回本)|勝率\s*\d|獲利\s*\d+\s*[%％]`,
  String.raw`老師帶|投顧老師|帶(?:你|妳|您|大家|各位|你們)\s*(?:賺|飛|翻倍|上車|入金|操作|跟單|做單)`,
  String.raw`(?:招(?:收|募)?|收|徵|找)\s*(?:學員|會員|跟單|新人)|(?:跟單|帶單)\s*(?:群|名額|請|歡迎|加|私)`,
  String.raw`報(?:明)?牌\s*(?:給|群|加|私)|(?:加|進|入)\s*(?:群|LINE|line|賴).{0,8}(?:飆股|明牌|帶單|內線)`,
].join("|"), "i");
/** 是否為「明確招攬投資」的文字（給 UNSURE 通知判斷用）。 */
export function investSolicit(text) { return INVEST_SOLICIT.test(String(text ?? "").normalize("NFKC")); }

export const REPEAT_SCAM = "同一人 24 小時內第 2 次判詐騙";
/** 文字訊息的通知層判斷（呼叫端只在原本沒有處置時呼叫）。回 names（空陣列＝不通知）。 */
export function textNotifyReasons({ text, chatId, senderId, result, tracker, shorteners = [], inviteExpanded = false, protectedSender = false, log }) {
  const names = [];
  if (isAntiScamBotAlert(text)) return names; // 其他防詐機器人的提醒：不通知

  const ns = notifyScore(text, { verdict: result.verdict, review: result.review, protectedSender });
  if (ns.notify) names.push(...ns.names);
  // 10/23 誤判（交易群只說「有入金一點」也被通知）：投資字眼單獨出現（入金、出金、翻倍、內線、帶單…）是交易群日常用語。
  // 只有第一層判 SCAM，或第一層 UNSURE 且文字是「明確招攬」（叫人入金、帶你賺、保證獲利、招收跟單…）才通知；單純提到＋不確定只記錄。
  // 10/24 自動反思：第一層 SCAM 但雲端覆核明確判 OK、沒網址、也不是明確招攬（交易群閒聊）時不通知，只會更少通知。
  const investSolicited = investSolicit(text);
  const reviewCleared = result.review === "OK" && !investSolicited && !hasLinkOrInvite(String(text ?? ""));
  if ((result.names ?? []).includes("投資帶單") && ((result.verdict === "SCAM" && !reviewCleared) || (result.verdict === "UNSURE" && investSolicited))) names.push("投資帶單＋第一層非 OK");
  // 10/23 誤判：0 分＋覆核 UNSURE 只因「第 2 次判詐騙」就通知。10/22 規則：0 分不可只因模型判詐騙就警告。
  // 0 分時這條只有「覆核也 SCAM 且帶確定特徵」才算；否則照樣計次、只記錄（zeroScoreRepeatLogged）。
  if (result.verdict === "SCAM" && tracker.scam(senderId)) {
    const zero = !(Number(result.score) > 0);
    if (!zero || (result.review === "SCAM" && zeroScoreShouldNotify(result.names))) names.push(REPEAT_SCAM);
    else if (log) log({ zeroScoreRepeatLogged: true });
  }
  // 跨群同內容：只有含群組邀請（line.me/ti/g、ti/g2、社群邀請、或短網址展開後是群組邀請）才算（維護者 10/22 15:51 修正）。
  // 一般網址跨群重複可能只是推廣：不因「跨群」單獨通知，只回 crossChatPlain 給呼叫端記錄。
  const hasInvite = inviteExpanded || INVITE_RE.test(String(text ?? ""));
  const chats = (hasInvite || firstUrl(text)) ? tracker.crossChat(text, chatId) : 1;
  if (hasInvite && chats >= 2) names.push(CROSS_INVITE);
  else if (chats >= 2 && log) log({ crossChatPlain: chats });
  // h：帶子網域的短網址寫法（例如 xx.supr.link）：只通知（踢人規則不變）。
  for (const u of String(text ?? "").match(URL_RE) ?? []) {
    const host = (u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase();
    if (shorteners.some((d) => host.endsWith(`.${d}`) && host !== `www.${d}`)) { names.push("子網域短網址"); break; }
  }
  names.push(...intelNotify1025(text, { protectedSender, shorteners }));
  if (tracker.followsProfit(chatId, senderId, text)) names.push("獲利截圖後接著貼網址／叫人私訊");
  // 10/22 20:51 誤判後：0 分只靠模型判詐不通知；要有確定特徵（群組邀請、未知短網址、已知詐騙網域）才通知。
  if (result.zeroScoreScamReviewed && zeroScoreShouldNotify(result.names)) names.push("0 分但第一層與雲端覆核都判詐騙");
  return [...new Set(names)];
}

/** d：同群 ≥2 個非管理員帳號頭像相同，或暱稱 NFKC 相同且像真管理員。 */
export function makeLookalikeTracker({ max = 5000 } = {}) {
  const byAvatar = new Map(); // chat avatarKey → Set(sender)
  const byName = new Map();   // chat nfkcName → Set(sender)
  const norm = (n) => String(n ?? "").normalize("NFKC").replace(/[\s\u200B-\u200F\u2060\uFEFF]/g, "").toLowerCase();
  const add = (map, key, id) => { const s = map.get(key) ?? new Set(); s.add(id); map.set(key, s); if (map.size > max) map.delete(map.keys().next().value); return s.size; };
  return {
    norm,
    /** adminNames：這群真管理員暱稱（NFKC 後）。回觸發的理由。 */
    see({ chatId, senderId, avatarKey, senderName, adminNames = [] }) {
      const names = [];
      if (avatarKey && add(byAvatar, `${chatId} ${avatarKey}`, senderId) >= 2) names.push("同群多個帳號頭像相同");
      const n = norm(senderName);
      if (n && add(byName, `${chatId} ${n}`, senderId) >= 2 && adminNames.map(norm).some((a) => a && (a === n || n.includes(a) || a.includes(n)))) names.push("同群多個帳號暱稱相同且像真管理員");
      return names;
    },
  };
}

// ── 仿冒群主／管理員（踢人群直接刪踢，維護者 10/22 15:53）────────────
const HOMOGLYPH = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ⅼ": "l", "Ӏ": "l", "ο": "o", "α": "a", "ν": "v", "ρ": "p", "τ": "t", "κ": "k", "ι": "i", "Ꭺ": "a" };
const INVIS = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/gu;
const CROWN = /[👑♔♕♚♛🤴👸]/u;
/** NFKC＋去零寬／特殊符號／同形字。 */
export function canonName(raw) {
  return [...String(raw ?? "").normalize("NFKC").replace(INVIS, "").toLowerCase()].map((c) => HOMOGLYPH[c] ?? c).join("").replace(/[^\p{L}\p{N}]/gu, "");
}
function nearlySame(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] <= 1;
}
/** 回 { kick, signals, victim }。只有暱稱仿冒＋（同頭像 ID／皇冠符號／特殊符號偽裝）才 kick；頭像模型判皇冠不在這裡用。 */
export function impersonatorKick({ perChatKick, protectedMember, senderName, avatarKey, admins = [] }) {
  if (!perChatKick || protectedMember) return { kick: false, signals: [] };
  const me = canonName(senderName);
  if (me.length < 2) return { kick: false, signals: [] };
  for (const admin of admins) {
    const target = canonName(admin?.name);
    if (!nearlySame(me, target)) continue;
    const signals = [];
    if (avatarKey && admin.avatarKey && avatarKey === admin.avatarKey) signals.push("頭像 ID 與真管理員相同");
    if (CROWN.test(String(senderName)) && !CROWN.test(String(admin.name ?? ""))) signals.push("暱稱含皇冠符號");
    const raw = String(senderName ?? "").normalize("NFKC");
    const disguised = new RegExp(INVIS.source, "u").test(String(senderName ?? "")) || [...raw.toLowerCase()].some((c) => HOMOGLYPH[c]) || (raw.replace(/[\p{L}\p{N}\s]/gu, "").replace(CROWN, "") !== String(admin.name ?? "").normalize("NFKC").replace(/[\p{L}\p{N}\s]/gu, "") && raw !== String(admin.name ?? "").normalize("NFKC"));
    if (disguised) signals.push("特殊符號偽裝暱稱");
    if (signals.length) return { kick: true, signals, victim: admin.name };
  }
  return { kick: false, signals: [] };
}

// ── 16:31 誤判修正：知識／社群網站放行、只有覆核判 SCAM 不通知 ─────────────
const KNOWLEDGE_PAGE = /<title[^>]*>[^<]{0,200}(?:社群|社區|community|技術|開源|open\s*source|docs?|documentation|文件|教學|tutorial|conference|研討會|年會|meetup|聚會|開發者|developer|blog|部落格|wiki)[^<]{0,200}<\/title>|<meta[^>]+(?:og:type"[^>]+content="(?:article|website)"[^>]*>[\s\S]{0,400}(?:社群|community|技術|開源|docs|教學)|name="description"[^>]+content="[^"]{0,300}(?:社群|社區|community|技術|開源|open source|開發者|developer|教學|文件))/i;
const SHOP_PAGE = /加入購物車|立即購買|add to cart|buy now|結帳|checkout|信用卡/i;
/** 展開／抓到的頁面是不是知識／社群／技術文件（購物頁不算）。 */
export function isKnowledgePage(url, html = "") {
  if (SHOP_PAGE.test(String(html))) return false;
  return urlKind(url) === "知識" || KNOWLEDGE_PAGE.test(String(html).slice(0, 20000));
}
/** 確定特徵：有這些就不因「只有覆核判 SCAM」而降級。 */
export const CERTAIN_FEATURES = new Set(["群組邀請連結", "短網址導向群組邀請", "疑似短網址", "短網址", "已知詐騙網域", "催促加入新群", "假群組公告", "假群組連結"]);
/** 第一層 Claude 判 OK、只有覆核判 SCAM、沒有確定特徵 → true＝只記錄不通知不標記。 */
export function reviewOnlyScam({ verdict, model, review, names = [] }) {
  return verdict === "OK" && /^claude/i.test(String(model ?? "")) && review === "SCAM" && !names.some((n) => CERTAIN_FEATURES.has(n));
}

// ── 主流影音／社群網址：本身不能當詐騙依據 ─────────────────────────────
export const MAINSTREAM_MEDIA_DOMAINS = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "vimeo.com", "bilibili.com", "b23.tv", "twitch.tv", "tiktok.com", "instagram.com", "facebook.com", "fb.watch", "threads.net", "threads.com", "x.com", "twitter.com", "reddit.com", "podcasts.apple.com", "open.spotify.com",
  // 主流交易所與看盤工具：網址本身不是詐騙依據（邀請碼、帶單、私訊等仍由規則計分）。
  "tradingview.com", "pionex.com", "binance.com", "okx.com", "bybit.com", "bitget.com", "coinmarketcap.com", "coingecko.com", "max.maicoin.com", "bitopro.com", "investing.com", "cnyes.com"];
// 加上平台官方短網址與主流內容網站（新聞、論壇、電商、交易所）。帶路徑的項目（goo.gl/maps）只比主機。
const ALL_MEDIA = [...new Set([...MAINSTREAM_MEDIA_DOMAINS, ...MAINSTREAM_CONTENT_DOMAINS, ...PLATFORM_SHORTENERS.filter((d) => !d.includes("/"))])];
const MEDIA_HOST = (host) => ALL_MEDIA.some((d) => host === d || host.endsWith(`.${d}`));
/** 主機名稱是主流影音／社群網站（含子網域，例如 m.youtube.com）。仿冒網域（youtube.com.evil.xyz、fakeyoutube.com）不算。 */
export function isMainstreamMediaHost(host) {
  return MEDIA_HOST(String(host ?? "").toLowerCase().replace(/^www\./, ""));
}
/** 訊息裡有網址，而且全部都是主流影音／社群網址。 */
export function onlyMainstreamMediaLinks(text) {
  const hosts = (String(text ?? "").match(URL_RE) ?? []).map((u) => (u.replace(/^https?:\/\//i, "").split(/[/?#:]/)[0] || "").toLowerCase());
  return hosts.length > 0 && hosts.every(isMainstreamMediaHost);
}
/** 規則 0 分、模型判詐：只有帶確定特徵時才通知，否則只記錄。 */
export function zeroScoreShouldNotify(names = []) {
  return (names ?? []).some((n) => CERTAIN_FEATURES.has(n));
}

// ── 10/25 情資（只通知，絕不進 rules.mjs 踢人計分、不在 MINER_KICKABLE）─────────────
// 共同排除：白名單／真管理員（protectedSender）、防詐提醒語氣（含「這是詐騙嗎」）、提到派網但沒附連結。
// YouTube 與主流平台官方短網址不算短網址／非官方網域。
export const INTEL_MOVE3 = "換群三段式（舊群刪除＋加新群＋連結）";
export const INTEL_SUBSHORT = "短網址前加子網域＋短代碼";
export const INTEL_VOTE_COUPON = "投票／領券＋非官方連結或回傳驗證碼";
const ASK_IF_SCAM = /(?:這|此|這個|這是|是不是|是否).{0,6}詐騙(?:嗎|吗|\?|？)|詐騙嗎/;
const WARN_EXTRA = /(?:是|為)(?:詐騙|假群|假的)|(?:別|不要|勿|千萬別)上當|防詐(?:提醒|宣導)/;
const SPACES = /[\s\u3000\u200B-\u200D\u2060\uFEFF]/g;
const OLD_GROUP_GONE = /(?:舊|本|此|這個|原|目前的?|現在的?)?(?:群|群組|社群|社團)(?:即將|將|會|明天|今天|明日|今日|已經?|要)?.{0,6}(?:刪除|解散|關閉|停用|收掉)|(?:刪除|解散|關閉)(?:本|此|舊|這個)?(?:群|群組|社群)/;
const JOIN_NEW = /(?:加入|進入?|移到|移至|轉到|搬到|前往|點擊?加入).{0,6}新(?:的)?(?:群|群組|社群|社團|族群)|新(?:的)?(?:群|群組|社群|社團|族群).{0,8}(?:加入|連結|入口)/;
const VOTE_COUPON = /投票|拉票|票選|幫.{0,4}投(?:票|一票)|領(?:取)?.{0,4}(?:飲料券|折價券|優惠券|禮券)|(?:飲料券|折價券|優惠券).{0,6}(?:領|送)/;
const CODE_BACK = /(?:回傳|傳|給|提供|輸入|告訴).{0,6}(?:簡訊)?(?:驗證碼|認證碼)|(?:驗證碼|認證碼).{0,6}(?:傳|給|回傳|截圖|告訴)/;
const SHORTCODE_PATH = /^\/[A-Za-z0-9_-]{3,12}\/?$/;
function urlsOf(t) { return String(t).match(URL_RE) ?? []; }
function pathOf(u) { const m = String(u).replace(/^https?:\/\//i, "").match(/^[^/?#]+(\/[^?#\s]*)?/); return m?.[1] ?? ""; }
function isShortHost(host, shorteners) { return !isMainstreamMediaHost(host) && shorteners.some((d) => host === d || host.endsWith(`.${d}`)); }
/** 回 10/25 三條只通知規則的命中理由。 */
export function intelNotify1025(text, { protectedSender = false, shorteners = RULE_SHORTENERS } = {}) {
  if (protectedSender) return [];
  const raw = String(text ?? "");
  const t = raw.replace(SPACES, "").normalize("NFKC");
  const urls = urlsOf(raw.normalize("NFKC"));
  const invite = INVITE_RE.test(t);
  if (ANTI_SCAM_WARNING.test(t) || ASK_IF_SCAM.test(t) || WARN_EXTRA.test(t)) return [];
  if (/派網|pionex/i.test(t) && !urls.length && !invite) return [];
  const hosts = urls.map(hostOf).map((h) => h.split(":")[0]);
  const names = [];
  const shortUrl = hosts.some((h) => isShortHost(h, shorteners));
  if (OLD_GROUP_GONE.test(t) && JOIN_NEW.test(t) && (invite || shortUrl)) names.push(INTEL_MOVE3);
  if (urls.some((u) => { const h = hostOf(u).split(":")[0]; return shorteners.some((d) => h.endsWith(`.${d}`) && h !== `www.${d}`) && !isMainstreamMediaHost(h) && SHORTCODE_PATH.test(pathOf(u)); })) names.push(INTEL_SUBSHORT);
  const offHost = hosts.some((h) => !isMainstreamMediaHost(h) && !OFFICIAL_HOST.test(h));
  if (VOTE_COUPON.test(t) && (offHost || shortUrl || CODE_BACK.test(t))) names.push(INTEL_VOTE_COUPON);
  return names;
}
