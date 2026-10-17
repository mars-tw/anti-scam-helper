// 規則計分（反詐守衛第一層）：每類命中加分，同一類只算一次。純函式，方便測試（test/guard-rules.test.mjs）。
// 比對前先做正規化：全形轉半形（NFKC），並另外準備一份「去掉所有空白」的版本（含全形空白、零寬字元），
// 「本 群 明 天 要 刪 除」「換　群」這類用空格拆字躲關鍵字的寫法也會命中。原文或去空白版任一命中就算。

// 常見短網址服務（貼這些等於看不到真正的目的地）。
export const SHORTENERS = ["bit.ly", "bit.do", "reurl.cc", "tinyurl.com", "tiny.cc", "pse.is", ...["", 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`lihi${n}.cc`, `lihi${n}.com`, `lihi${n}.me`]), "ppt.cc", "myppt.cc", "is.gd", "v.gd", "t.co", "t.ly", "shorturl.at", "shorturl.asia", "cutt.ly", "1url.cz", "rb.gy", "ow.ly", "buff.ly", "s.id", "goo.su", "gg.gg", "x.gd", "rebrand.ly", "short.gy", "shorturl.gg", "0rz.tw", "risu.io", "cli.re", "u.to", "clck.ru", "qrco.de", "tw.gg", "url.cn", "dwz.cn", "suo.im"];

// 詢問或提醒詐騙（「這是詐騙嗎」「是不是詐騙」「有人收到這個嗎」「這可信嗎」「小心詐騙」）：扣分，也是 questionRedact 認定「詢問者」的依據。
export const ASK_SCAM = /(這|那)(個|些|則|種)?(是|應該是|根本是|算)詐騙|是詐騙嗎|詐騙嗎|是不是(詐騙|詐團|騙人|騙局|假的)|是(真|假)的嗎|有(人|沒有人)(也)?收到(這|類似|一樣)|(這|那)(個|種|則)?.{0,4}(可信|能信|可以信|靠譜|安全)(嗎|不)|可信嗎|(不要|別|勿|千萬別)(點|加入|相信|匯款|上當|理)|冒充|假冒|165\s*(查證|反詐|專線)?|小心(詐騙|被騙|上當)|(有人|大家).{0,6}(被騙|遇過|知道.{0,6}(真假|詐騙))/;

// ── 規則：每類命中加分，同一類只算一次 ──────────────────────────
export const RULES = [
  { name: "LINE 邀請／加好友", score: 3, pattern: /line\.me\/(ti|R\/ti)|lin\.ee\/|加\s*(我\s*)?(賴|line|LINE|Line)|(line|LINE|賴)\s*(id|ID)\s*[:：]?|ID\s*[:：]\s*@?\w{3,}/ },
  // 短網址：看不出真正去哪裡，詐騙引流常用。前面不能緊接英數字（避免 abc1url.cz 這類誤判）。
  { name: "短網址", score: 3, pattern: new RegExp(`(?<![\\w.-])(${SHORTENERS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\/[\\w-]`, "i") },
  // 一般網址只加 1 分；常見技術、地圖、影音網站（benignDomains）先拿掉再判斷，不加分。
  { name: "網址", score: 1, pattern: /https?:\/\/|www\.|(?<![\w.@-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[\w-]/i, onBenignStripped: true },
  { name: "投資帶單", score: 2, pattern: /飆股|帶單|老師帶|投顧老師|穩賺|保證(獲利|賺)|勝率\s*\d|漲停板?.{0,6}(分享|帶|跟)|主力.{0,4}(進場|拉抬)|內線(消息)?|出金|入金|翻倍|獲利\s*\d+\s*%|報(明)?牌/ },
  // 虛擬貨幣本身是正常話題；要配上收益、帶單、入金等字眼才算。
  { name: "虛幣引流", score: 2, pattern: /(虛擬貨幣|加密貨幣|虛幣|USDT|泰達幣|新幣|幣圈).{0,12}(帶單|保證|穩賺|翻倍|收益|日收|月收|套利|搬磚|出金|入金|認購|錢包地址|分紅)|(搬磚|套利).{0,8}(USDT|泰達幣|虛幣)/i },
  { name: "假冒名人報牌", score: 2, pattern: /(退休|離職|資深)(的)?(半導體|台積電|鴻海)?(工程師|經理|主管).{0,15}(報股|報牌|明牌|內幕|內線|飆股)|訂單(已經)?接到\s*20\d\d|(財經|股市)(名人|大師).{0,10}(帶|群|分享|免費)/ },
  { name: "假投資平台", score: 2, pattern: /下載.{0,6}(app|APP|App).{0,10}(投資|交易|入金|註冊)|(投資|交易)平台.{0,8}(註冊|入金|邀請碼)|洗碼量|(繳|付).{0,4}保證金.{0,6}(出金|提領|解凍)|IP\s*異常|帳號.{0,4}凍結.{0,8}(出金|客服)/i },
  { name: "兼職刷單", score: 2, pattern: /兼職.{0,10}(日領|日結|月入|輕鬆|在家|加)|日領|日結|刷單|在家(工作|賺)|輕鬆賺|躺賺|零經驗.{0,6}(月入|日入|日領)|月入\s*\d+萬|按讚.{0,6}(賺|領)|墊付.{0,6}返(佣|傭)|領任務/ },
  { name: "私下聯繫", score: 2, pattern: /私我|私聊|私訊我|密我|加我好友|單獨聯繫|私下聯繫|找我拿|點我頭像|頭像加|加好友.{0,6}(領|拿|送|詳談)/ },
  { name: "貸款博弈", score: 2, pattern: /免審|免照會|快速撥款|當日撥款|小額貸|借貸|代辦貸款|(信用|聯徵)(瑕疵|不良).{0,6}(可貸|也能貸)|博弈|娛樂城|百家樂|運彩.{0,6}(帶|老師|穩)|老虎機|首儲|儲值送/ },
  // 假搬家：冒充管理員要成員移到「新群」，新群裡才是投資詐騙或釣魚。真正的社群管理員不受守衛處理。
  { name: "群組搬家", score: 6, pattern: /(移|搬|轉|遷)(至|到|往|去)\s*(新|備用|另一?個)?\s*\d*\s*(號)?\s*(群|社群)|新\s*\d+\s*(號)?\s*(群|社群)|重新\s*(➕|＋|\+|加入|加一下|入群|進群)|統一\s*(核准|核準|審核|通過)|舊群.{0,6}(解散|關閉|停用)|(群組|社群)\s*(搬家|遷移)|備用群|(另外|重新)(成立|建立?|開)(了)?(新)?(群|社群)|(機器人|廣告)(太多|很多|洗版).{0,15}(新群|新社群)|開啟新專案/ },
  // 假換群（明確版）：「本群明天要刪除」「請大家加入新群」「新群連結如下」。比對時已去掉空白（「本 群 明 天 要 刪 除」也算）。
  { name: "假換群公告", score: 6, pattern: /(請|大家|各位|所有人|全體|麻煩).{0,6}加入(到)?(我們的?)?新(的)?(群|社群|群組)|(本|此|這個?|原|舊)(群|社群|群組)(明天|今天|今晚|即將|馬上|稍後|近期|將|要|會|已經|已|準備)+.{0,3}(被)?(刪除|刪掉|解散|關閉|停用|作廢|不再使用)|(群|社群|群組)(明天|今天|今晚|即將|馬上|稍後|近期|將|要|會)+.{0,4}(被)?(刪除|刪掉|解散|關閉|停用)|新(的)?(群|社群|群組)(連結|網址|入口|QR|qr)?(如下|在這|在此|點這|點此|請點|[:：👉⬇↓])|請(大家|各位|所有人|全體)?.{0,6}(移步|轉移|前往|加入|點擊?)(到|至)?(新|另一?個|備用)(的)?(群|社群|群組)/ },
  // 換群（單獨出現）：可能只是在聊天或提醒別人，只送覆核、不夠踢人分數。
  { name: "換群字眼", score: 3, pattern: /換(新)?(群|社群|群組)|(群|社群|群組)(搬|換|轉)(新)?(家|位置|地方)/ },
  { name: "中獎客服", score: 2, pattern: /恭喜.{0,8}(中獎|抽中)|領取獎(金|品)|解除分期|誤設.{0,4}分期|重複扣款|客服通知|帳戶(異常|凍結)|驗證身分.{0,6}連結|實名驗證|開通金流|ATM.{0,6}(操作|解除)|無卡提款|遊戲點數/i },
  { name: "愛情交友", score: 2, pattern: /(軍醫|戰地|聯合國|維和).{0,8}(醫生|軍官|官員|部隊)?.{0,15}(包裹|禮物|關稅|匯|投資)|(包裹|禮物).{0,8}(海關|關稅)|結婚基金/ },
  { name: "盜帳號／收帳戶", score: 3, pattern: /(幫忙|幫我)投票.{0,15}(網址|連結|登入|https?:)|(傳|給|提供).{0,6}(簡訊)?(驗證碼|認證碼)|(驗證碼|認證碼).{0,10}(傳給我|給我|告訴我|截圖給我)|收購.{0,4}(帳戶|帳號|存摺)|(出租|租借|提供)(帳戶|存摺|提款卡)|出國.{0,4}(打工|工作).{0,6}高薪/ },
  // 提醒或詢問詐騙（「這是詐騙嗎」「不要點」「有人冒充管理員」）：扣分，避免把好心提醒的人踢掉。
  { name: "提醒／詢問詐騙", score: -4, pattern: ASK_SCAM },
];

// 正常技術、地圖、影音、官方網站：不因為「有網址」加分（短網址、LINE 邀請另外計）。
export const DEFAULT_BENIGN_DOMAINS = ["github.com", "gitlab.com", "google.com", "goo.gl/maps", "maps.app.goo.gl", "youtube.com", "youtu.be", "openai.com", "anthropic.com", "claude.ai", "x.ai", "grok.com", "gemini.google.com", "ai.google.dev", "huggingface.co", "npmjs.com", "pypi.org", "stackoverflow.com", "wikipedia.org", "medium.com", "hackmd.io", "notion.so", "x.com", "twitter.com", "facebook.com", "threads.net", "gov.tw", "edu.tw", "microsoft.com", "apple.com", "cursor.com", "meta.ai", "nvidia.com", "amd.com", "intel.com", "amazon.com", "aws.amazon.com", "cloudflare.com", "ibm.com", "oracle.com", "adobe.com", "samsung.com", "tsmc.com", "asus.com", "docker.com", "python.org", "nodejs.org", "mozilla.org", "kaggle.com", "arxiv.org", "mistral.ai", "deepseek.com", "perplexity.ai", "ollama.com", "openrouter.ai", "vercel.com", "azure.com", "bitbucket.org", "antigravity.google", "docs.", "developer."];
// 網域前後要有邊界：fakenvidia.com、nvidia.com.evil.ru 這類仿冒不算一般網域（docs.／developer. 這類前綴除外）。
export function benignUrlPattern(domains = DEFAULT_BENIGN_DOMAINS) {
  return new RegExp(`(?<![\\w.-])(https?:\\/\\/)?([\\w-]+\\.)*(${domains.map((d) => d.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + (d.endsWith(".") ? "" : "(?=$|[\\/?#:\\s，。）)」』])")).join("|")})[^\\s，。）)」』]*`, "gi");
}

/** 正規化：全形轉半形；compact 另外去掉所有空白與看不見的字元。 */
export function normalizeForRules(text) {
  const normal = String(text ?? "").normalize("NFKC");
  const compact = normal.replace(/[\s\u200b-\u200f\u2060\ufeff\u3000]+/g, "");
  return { normal, compact };
}

// 暱稱自稱管理員／官方（一般成員才算；真正的管理員有 senderRole，不會進到規則判斷）。
const STAFF_NICKNAME = /管理員|管理者|群主|版主|官方|客服|小編/;

/** 建立計分函式。benignDomains：一般網站清單（省略用預設）。 */
export function makeRuleScorer(benignDomains) {
  const benignUrl = benignUrlPattern(benignDomains ?? DEFAULT_BENIGN_DOMAINS);
  return function ruleScore(message, text) {
    const { normal, compact } = normalizeForRules(text);
    const strippedNormal = normal.replace(benignUrl, "［一般網站］");
    const strippedCompact = compact.replace(benignUrl, "［一般網站］");
    const hits = RULES.filter((rule) => rule.onBenignStripped
      ? rule.pattern.test(strippedNormal) || rule.pattern.test(strippedCompact)
      : rule.pattern.test(normal) || rule.pattern.test(compact));
    let score = Math.max(0, hits.reduce((sum, rule) => sum + rule.score, 0));
    const names = hits.map((rule) => rule.name);
    // 在群組裡丟聯絡人卡片，是常見的引流手法。
    if (message?.card?.kind === "contact") {
      score += 3;
      names.push("分享聯絡人");
    }
    // 一般成員把暱稱取成「管理員小美」「官方客服」：冒充管理員發公告的常見手法。單獨出現不到覆核門檻，只是加權。
    if (score > 0 && !message?.senderRole && STAFF_NICKNAME.test(String(message?.senderName ?? "").normalize("NFKC").replace(/\s/g, ""))) {
      score += 2;
      names.push("暱稱自稱管理員");
    }
    return { score, names };
  };
}
