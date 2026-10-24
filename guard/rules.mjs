// 規則計分（反詐守衛第一層）：每類命中加分，同一類只算一次。純函式，方便測試（test/guard-rules.test.mjs）。
// 比對前先做正規化：全形轉半形（NFKC），並另外準備一份「去掉所有空白」的版本（含全形空白、零寬字元），
// 「本 群 明 天 要 刪 除」「換　群」這類用空格拆字躲關鍵字的寫法也會命中。原文或去空白版任一命中就算。
import { analyzeName } from "./fakeadmin.mjs";

// 常見短網址服務（貼這些等於看不到真正的目的地）。
export const SHORTENERS = ["bit.ly", "bit.do", "reurl.cc", "tinyurl.com", "tiny.cc", "pse.is", ...["", 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`lihi${n}.cc`, `lihi${n}.com`, `lihi${n}.me`]), "ppt.cc", "myppt.cc", "is.gd", "v.gd", "t.ly", "shorturl.at", "shorturl.asia", "cutt.ly", "1url.cz", "ada.nz", "cutt.us", "tny.im", "u.nu", "n9.cl", "surl.li", "ouo.io", "shrtco.de", "9m.no", "t.cn", "kutt.it", "han.gl", "me2.do", "vo.la", "sor.bz", "rb.gy", "ow.ly", "buff.ly", "s.id", "goo.su", "gg.gg", "x.gd", "rebrand.ly", "short.gy", "shorturl.gg", "0rz.tw", "risu.io", "cli.re", "u.to", "clck.ru", "qrco.de", "tw.gg", "url.cn", "dwz.cn", "suo.im", "supr.link"];

// 平台官方短網址（影音、社群、地圖、主流電商自家的分享連結）：目的地一定在該平台上，不算「看不到目的地的短網址」，
// 也不算詐騙依據（LINE 的 lin.ee 例外：照 LINE 邀請規則判斷）。
export const PLATFORM_SHORTENERS = ["youtu.be", "b23.tv", "t.co", "fb.me", "fb.watch", "redd.it", "amzn.to", "amzn.asia", "a.co", "shp.ee", "s.shopee.tw", "s.click.taobao.com", "m.tb.cn", "xhslink.com", "v.douyin.com", "vm.tiktok.com", "vt.tiktok.com", "spoti.fi", "apple.co", "goo.gl/maps", "maps.app.goo.gl", "g.co", "msft.it", "aka.ms", "nyti.ms", "wp.me", "dlvr.it", "ift.tt", "lnkd.in", "pin.it"];
// 主流影音／社群／新聞／交易所等網站：網址本身不加分（規則另外看引流字眼）。
export const MAINSTREAM_CONTENT_DOMAINS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "bilibili.com", "b23.tv", "twitch.tv", "tiktok.com", "douyin.com", "xiaohongshu.com", "instagram.com", "facebook.com", "fb.watch", "threads.net", "threads.com", "x.com", "twitter.com", "reddit.com", "podcasts.apple.com", "open.spotify.com", "spotify.com", "soundcloud.com", "dcard.tw", "ptt.cc", "mobile01.com", "bahamut.com.tw", "gamer.com.tw", "pixnet.net", "vocus.cc", "substack.com", "dev.to", "zhihu.com", "weibo.com", "linkedin.com", "pinterest.com", "news.google.com", "udn.com", "ltn.com.tw", "chinatimes.com", "ettoday.net", "setn.com", "tvbs.com.tw", "cna.com.tw", "pts.org.tw", "storm.mg", "thenewslens.com", "technews.tw", "ithome.com.tw", "inside.com.tw", "bnext.com.tw", "businessweekly.com.tw", "cw.com.tw", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "reuters.com", "bloomberg.com", "theverge.com", "techcrunch.com", "wired.com", "engadget.com", "nikkei.com", "tradingview.com", "pionex.com", "binance.com", "okx.com", "bybit.com", "bitget.com", "coinmarketcap.com", "coingecko.com", "max.maicoin.com", "bitopro.com", "investing.com", "cnyes.com", "shopee.tw", "momoshop.com.tw", "pchome.com.tw", "books.com.tw", "amazon.co.jp", "rakuten.com.tw", "taobao.com", "tmall.com", "jd.com"];

// 詢問或提醒詐騙（「這是詐騙嗎」「是不是詐騙」「有人收到這個嗎」「這可信嗎」「小心詐騙」）：扣分，也是 questionRedact 認定「詢問者」的依據。
export const ASK_SCAM = /(這|那)(個|些|則|種)?(是|應該是|根本是|算)詐騙|是詐騙嗎|詐騙嗎|是不是(詐騙|詐團|騙人|騙局|假的)|是(真|假)的嗎|有(人|沒有人)(也)?收到(這|類似|一樣)|(這|那)(個|種|則)?.{0,4}(可信|能信|可以信|靠譜|安全)(嗎|不)|可信嗎|(不要|別|勿|千萬別)(點|加入|相信|匯款|上當|理)|冒充|假冒|165\s*(查證|反詐|專線)?|小心(詐騙|被騙|上當)|(有人|大家).{0,6}(被騙|遇過|知道.{0,6}(真假|詐騙))/;

// 防詐提醒語氣（「疑似詐騙」「不要亂加」「小心詐騙」）：通知層（notify-rules.mjs）與踢人計分共用。
export const ANTI_SCAM_WARNING = /(?:疑似|可能是?|小心|注意|提醒|警告|防範|謹防|慎防|當心|嚴防).{0,10}(?:詐騙|假群|假冒|冒充|冒用|被騙)|(?:不要|勿|別|切勿|請勿|千萬別|千萬不要)\s*(?:隨便|亂)?\s*(?:加入|點|加|相信|理會|上當|掃)/;
// 10/24 維護者同意：沒附網址／短網址／群組邀請／LINE ID／加好友，且是防詐提醒語氣時，這幾條踢人計分不加分（只會更少踢）。
export const WARNING_ZERO_RULES = new Set(["疑似假群組", "官方名義導向群組", "盜帳號／收帳戶", "提醒／詢問詐騙"]);
const LINK_RULES = new Set(["LINE 邀請／加好友", "短網址", "網址"]);
const ANY_LINK = /https?:\/\/|www\.|(?<![\w.@-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/|line\.me\/|lin\.ee\/|openchat\.line\.me|加\s*(我\s*)?(賴|line)|(line|賴)\s*id|ID\s*[:：]\s*@?\w{3,}/i;

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
  { name: "假群組公告", score: 6, pattern: /(移|搬|轉|遷)(至|到|往|去)\s*(新|備用|另一?個)?\s*\d*\s*(號)?\s*(群|社群)|新\s*\d+\s*(號)?\s*(群|社群)|重新\s*(➕|＋|\+|加入|加一下|入群|進群)|統一\s*(核准|核準|審核|通過)|舊群.{0,6}(解散|關閉|停用)|(群組|社群)\s*(搬家|遷移)|備用群|(另外|重新)(成立|建立?|開)(了)?(新)?(群|社群)|(機器人|廣告)(太多|很多|洗版).{0,15}(新群|新社群)|開啟新專案/ },
  // 假換群（明確版）：「本群明天要刪除」「請大家加入新群」「新群連結如下」。比對時已去掉空白（「本 群 明 天 要 刪 除」也算）。
  { name: "假群組連結", score: 6, pattern: /(請|大家|各位|所有人|全體|麻煩).{0,6}(加入|進入|前往|移至|轉到)(到)?(我們的?)?新(的)?(群|社群|群組|社團)|(本|此|這個?|原|舊)(群|社群|群組|社團)(決定|宣布|將於|於|明天|明日|明早|今天|今晚|即將|馬上|稍後|近期|將|要|會|已經|已|準備)+.{0,3}(被)?(刪除|刪掉|解散|關閉|停用|作廢|不再使用)|(群|社群|群組|社團)(決定|宣布|將於|明天|明日|明早|今天|今晚|即將|馬上|稍後|近期|將|要|會)+.{0,4}(被)?(刪除|刪掉|解散|關閉|停用)|新(的)?(群|社群|群組|社團)(連結|網址|入口|QR|qr)?(如下|在這|在此|點這|點此|請點|[:：👉⬇↓])|請(大家|各位|所有人|全體)?.{0,6}(移步|轉移|前往|加入|點擊?)(到|至)?(新|另一?個|備用)(的)?(群|社群|群組|社團)|(廣告|騷擾|詐騙)(太多|過多|很多|嚴重).{0,24}(解散|關閉|刪除|新(群|社群|群組|社團))/ },
  // 換群（單獨出現）：可能只是在聊天或提醒別人，只送覆核、不夠踢人分數。
  { name: "疑似假群組", score: 3, pattern: /換(新)?(群|社群|群組)|(群|社群|群組)(搬|換|轉)(新)?(家|位置|地方)/ },
  // 假冒知名廠商／官方名義邀請加入群組（例：短網址落地頁假裝是某旅行社、品牌官方，實際跳到外部 LINE 社群邀請）。
  // 只加 2 分：單獨出現只送覆核；不改踢人門檻。
  { name: "假冒官方邀請入群", score: 2, pattern: /(官方|原廠|總公司|總部|品牌|公司|旅行社|銀行|航空|券商|客服中心|粉絲團).{0,12}(誠邀|邀請|邀您|歡迎|開放).{0,10}(加入|進入|入|免費加入).{0,8}(群|社群|群組|LINE\s*群|VIP|會員群|福利群)|(官方|專屬|VIP|會員|福利|優惠|粉絲)\s*(LINE)?\s*(社群|群組|交流群|福利群).{0,12}(點擊|點此|點我|請按|連結|加入|入群)/i },
  // 知名廠商通常用 LINE 官方帳號（@ 開頭，line.me/R/ti/p/@…）。自稱官方／品牌卻導向一般群組、社群邀請或個人帳號 → 加重。
  { name: "官方名義導向群組", score: 2, pattern: /^(?=[\s\S]*(官方|原廠|總公司|總部|品牌|旅行社|銀行|航空|券商|客服))(?=[\s\S]*(line\.me\/(?:R\/)?ti\/(?:g2?|p\/~)\/?|line\.me\/ti\/g2\/|(?:社群|群組).{0,6}(邀請|連結)))/i },
  // 有 @ 官方帳號連結只稍微減分，不是白名單（也有未認證的假官方帳號）。
  { name: "LINE 官方帳號連結", score: -1, pattern: /line\.me\/(?:R\/)?ti\/p\/@|line\.me\/R\/ti\/p\/%40/i },
  // 沒在清單裡的短網址：很短的網域（≤5 字＋2～3 字尾碼）＋只有短代碼路徑（可帶 /r/、/s/、/go/）。基本可疑分，避免一直靠清單補。
  { name: "疑似短網址", score: 2, onBenignStripped: true, normalOnly: true, pattern: new RegExp(`(?<![\\w.@-])(?:https?:\\/\\/)?(?!(?:${SHORTENERS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\/)[a-z0-9-]{1,5}\\.[a-z]{2,3}\\/(?:(?:r|s|go|l)\\/)?[A-Za-z0-9_-]{2,10}(?![\\w\\/.-])`, "i") },
  // 催大家加入新群／轉移到新群（假搬家的後續訊息，常見「還沒加入的請儘快申請進群」）。
  { name: "催促加入新群", score: 3, pattern: /(轉移|移轉|移動|遷移)(到|至)?(新|另一?個)(群|社群|群組)|新(群|社群|群組).{0,8}(重新)?審核(成員)?|(儘快|盡快|趕快|趕緊).{0,6}(申請)?(進群|入群|加入新(群|社群))|還沒(有)?加入的.{0,8}(請|儘快|盡快|趕快)/ },
  // 仿冒精品：1:1／複刻／高仿／原單／尾單／AAA 這類用語＋連結。
  { name: "仿冒精品連結", score: 3, pattern: /^(?=[\s\S]*(1\s*[:：比]\s*1|複刻|復刻|高仿|原單|尾單|A{3}級?|頂級(精品|名牌)|精品.{0,4}(複刻|高仿|代購)))(?=[\s\S]*(https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}\/))/i },
  // 數字子網域＋短路徑（6786.xxx.net/ck3 這類輪換網址）。
  { name: "數字子網域短路徑", score: 2, normalOnly: true, pattern: /(?<![\w.@-])(?:https?:\/\/)?\d{2,6}\.[a-z0-9-]+\.[a-z]{2,4}\/[A-Za-z0-9_-]{1,10}\/?(?![\w\/.-])/i },
  // 免費子網域（xxx.eu.cc 等）：常被拿來架一次性詐騙頁。
  { name: "免費子網域", score: 2, normalOnly: true, pattern: /(?<![\w.@-])(?:https?:\/\/)?[a-z0-9-]+\.(?:eu\.cc|us\.kg|eu\.org|pp\.ua|dpdns\.org|qzz\.io|ccwu\.cc|cn\.eu\.org)(?![a-z0-9-])/i },
  // 群組／社群邀請連結（line.me/ti/g、ti/g2、R/ti/g、openchat）：維護者 10/22 起只有真管理員與白名單可以發（他們在更前面就略過）。
  { name: "群組邀請連結", score: 3, pattern: /line\.me\/(?:R\/)?ti\/g2?\/|openchat\.line\.me\//i },
  { name: "中獎客服", score: 2, pattern: /恭喜.{0,8}(中獎|抽中)|領取獎(金|品)|解除分期|誤設.{0,4}分期|重複扣款|客服通知|帳戶(異常|凍結)|驗證身分.{0,6}連結|實名驗證|開通金流|ATM.{0,6}(操作|解除)|無卡提款|遊戲點數/i },
  { name: "愛情交友", score: 2, pattern: /(軍醫|戰地|聯合國|維和).{0,8}(醫生|軍官|官員|部隊)?.{0,15}(包裹|禮物|關稅|匯|投資)|(包裹|禮物).{0,8}(海關|關稅)|結婚基金/ },
  { name: "盜帳號／收帳戶", score: 3, pattern: /(幫忙|幫我)投票.{0,15}(網址|連結|登入|https?:)|(傳|給|提供).{0,6}(簡訊)?(驗證碼|認證碼)|(驗證碼|認證碼).{0,10}(傳給我|給我|告訴我|截圖給我)|收購.{0,4}(帳戶|帳號|存摺)|(出租|租借|提供)(帳戶|存摺|提款卡)|出國.{0,4}(打工|工作).{0,6}高薪/ },
  // 提醒或詢問詐騙（「這是詐騙嗎」「不要點」「有人冒充管理員」）：扣分，避免把好心提醒的人踢掉。
  // 假紅包：紅包＋引流（加賴／私訊）或要先付錢。
  { name: "假紅包", score: 4, pattern: /(紅包|red\s*packet).{0,30}(加\s*(我\s*)?(賴|line)|私(訊|聊|我)|密我|頭像|先(付|儲值|入金)|手續費|保證金|解凍|驗證碼|授權錢包)|(加\s*(我\s*)?(賴|line)|私(訊|聊|我)|密我).{0,30}(紅包|red\s*packet)/i },
  // 仿冒交易所網域（pi0nex、binance-gift.xyz…）。
  { name: "仿冒交易所網域", score: 5, pattern: /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?=[a-z0-9-]*(p[i1l]+[o0]n[e3]x|b[i1l]+n[a@4]nc[e3]|byb[i1l]+t))(?!(?:www\.|app\.|s\.|accounts\.)?(pionex|binance|bybit)\.(com|info)(?![\w.-]))(?:[a-z0-9-]+\.)+[a-z]{2,}/i },
  { name: "提醒／詢問詐騙", score: -4, pattern: ASK_SCAM },
];

// 正常技術、地圖、影音、官方網站：不因為「有網址」加分（短網址、LINE 邀請另外計）。
export const DEFAULT_BENIGN_DOMAINS = ["github.com", "gitlab.com", "google.com", "goo.gl/maps", "maps.app.goo.gl", "youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "bilibili.com", "twitch.tv", "instagram.com", "fb.watch", "reddit.com", "openai.com", "anthropic.com", "claude.ai", "x.ai", "grok.com", "gemini.google.com", "ai.google.dev", "huggingface.co", "npmjs.com", "pypi.org", "stackoverflow.com", "wikipedia.org", "medium.com", "hackmd.io", "notion.so", "x.com", "twitter.com", "facebook.com", "threads.net", "gov.tw", "edu.tw", "microsoft.com", "apple.com", "cursor.com", "meta.ai", "nvidia.com", "amd.com", "intel.com", "amazon.com", "aws.amazon.com", "cloudflare.com", "ibm.com", "oracle.com", "adobe.com", "samsung.com", "tsmc.com", "asus.com", "docker.com", "python.org", "nodejs.org", "mozilla.org", "kaggle.com", "arxiv.org", "mistral.ai", "deepseek.com", "perplexity.ai", "ollama.com", "openrouter.ai", "vercel.com", "azure.com", "bitbucket.org", "antigravity.google", "docs.", "developer."].concat(PLATFORM_SHORTENERS, MAINSTREAM_CONTENT_DOMAINS).filter((d, i, a) => a.indexOf(d) === i);
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
const STAFF_NICKNAME = /管理員|管理者|群管|管理|群主|版主|版務|官方|客服|小編/;

/** 建立計分函式。benignDomains：一般網站清單（省略用預設）。 */
/** 已知詐騙網域（本機設定 scamDomains，不進 git）：網域本身或其子網域出現在訊息裡。 */
export function scamDomainPattern(domains = []) {
  const list = (domains ?? []).map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return undefined;
  return new RegExp(`(?<![\\w-])(?:[a-z0-9-]+\\.)*(?:${list.map((d) => d.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?![a-z0-9-])`, "i");
}
export function makeRuleScorer(benignDomains, { scamDomains } = {}) {
  const scamDomain = scamDomainPattern(scamDomains);
  const benignUrl = benignUrlPattern(benignDomains ?? DEFAULT_BENIGN_DOMAINS);
  return function ruleScore(message, text) {
    const { normal, compact } = normalizeForRules(text);
    const strippedNormal = normal.replace(benignUrl, "［一般網站］");
    const strippedCompact = compact.replace(benignUrl, "［一般網站］");
    const hits = RULES.filter((rule) => rule.normalOnly
      ? rule.pattern.test(rule.onBenignStripped ? strippedNormal : normal)
      : rule.onBenignStripped
      ? rule.pattern.test(strippedNormal) || rule.pattern.test(strippedCompact)
      : rule.pattern.test(normal) || rule.pattern.test(compact));
    const warnNoLink = message?.card?.kind !== "contact" && !hits.some((rule) => LINK_RULES.has(rule.name)) && !ANY_LINK.test(normal) && !ANY_LINK.test(compact) && (ANTI_SCAM_WARNING.test(normal) || ANTI_SCAM_WARNING.test(compact));
    const ruleScoreOf = (rule) => (warnNoLink && WARNING_ZERO_RULES.has(rule.name) && rule.score > 0 ? 0 : rule.score);
    let score = Math.max(0, hits.reduce((sum, rule) => sum + ruleScoreOf(rule), 0));
    const names = hits.map((rule) => rule.name);
    if (scamDomain && scamDomain.test(normal)) { score += 3; names.push("已知詐騙網域"); }
    // 在群組裡丟聯絡人卡片，是常見的引流手法。
    if (message?.card?.kind === "contact") {
      score += 3;
      names.push("分享聯絡人");
    }
    // 一般成員把暱稱取成「管理員小美」「官方客服」：冒充管理員發公告的常見手法。單獨出現不到覆核門檻，只是加權。
    // 維護者 10/22：只有白名單（守衛在更前面就略過）與真正有權限的管理員（senderRole）算真管理員；
    // 其他人暱稱含 小編／管理／群管／版務 等字眼一律視為假冒（不再要求訊息本身有分數）。暱稱含「群管」大加分。
    const nick = String(message?.senderName ?? "").normalize("NFKC").replace(/\s/g, "");
    if (!message?.senderRole && (STAFF_NICKNAME.test(nick) || analyzeName(message?.senderName).signals.some((signal) => signal.type === "staff"))) {
      if (/群管/.test(nick)) { score += 4; names.push("暱稱冒稱群管"); }
      else { score += 2; names.push("暱稱自稱管理員"); }
    }
    return { score, names };
  };
}

/** 一般成員出現就一律判詐騙的特徵（維護者 10/22）：群組邀請、轉移／新群、未知短網址服務。 */
export const FORCED_SCAM_NAMES = new Set(["群組邀請連結", "催促加入新群", "假群組公告", "假群組連結", "疑似短網址", "短網址導向群組邀請"]);
export function forcedScamNames(names = []) { return names.filter((name) => FORCED_SCAM_NAMES.has(name)); }
