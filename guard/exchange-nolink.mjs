// 維護者原則：交易所（派網等）相關的討論、K 線、獲利／網格截圖、推薦碼，只要「沒有附連結」
// （網址、短網址、群組邀請、加好友 QR／LINE ID），一律只記錄：不通知、不標記、不計 strike、不進詐騙範例庫。
// 只會讓守衛更保守；踢人規則、kickMode、白名單、冒充管理員規則都不在這裡處理（呼叫端不會因此改變踢人）。

const EXCHANGE_TEXT = /派網|pionex|交易所|幣安|binance|okx|bybit|bitget|網格|合約|[kＫＫ]\s*線|看盤|推薦碼|邀請碼|返佣|usdt|btc|eth|比特幣|以太|虛擬貨幣|加密貨幣|幣圈|現貨|槓桿|多單|空單|做多|做空|爆倉|止盈|止損|獲利|盈利|收益|損益|持倉|倉位|入金|出金|帶單|跟單|機器人|套利|年化|資金費率/i;
// 文字裡的「連結」：網址、無 http 網域、LINE 邀請／加好友、寫出來的 LINE ID 或 @ID、叫人加好友／私訊。
const TEXT_LINK = /https?:\/\/|www\.|line\.me|lin\.ee|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|cc|me|tw|xyz|top|vip|info|app|link|ly|gl|co|ee|to|site|online|shop|club|pro|live)\b(?:\/\S*)?|(?:line|賴)\s*(?:id|ＩＤ)?\s*[:：]\s*@?[\w.-]{3,}|加\s*(?:我\s*)?(?:賴|line|好友)|(?<![\w.])@[a-z0-9][\w.-]{2,}|私訊我|私聊我|密我|加我/i;
// 不屬於這條豁免的：假群組（要大家轉移新群）、冒充管理員。
const OUT_OF_SCOPE = /新群|轉移|搬家|重新加入|管理員|群主|客服/;

/** 文字是否為「交易所相關、沒附任何連結」的一般內容。 */
export function exchangeTextNoLink(text) {
  const t = String(text ?? "").normalize("NFKC");
  return EXCHANGE_TEXT.test(t) && !TEXT_LINK.test(t) && !OUT_OF_SCOPE.test(t);
}

const EXCHANGE_IMAGE = /派網|pionex|交易所|幣安|binance|okx|bybit|bitget|網格|合約|K\s*線|看盤|圖表|價格|推薦碼|邀請碼|USDT|BTC|虛擬貨幣|加密貨幣|槓桿|倉位|持倉|獲利|盈利|收益|損益|報酬|對帳單|交易|機器人|[+＋]\s*[0-9]/i;
// 看圖理由裡的連結訊號（否定句段落先拿掉）。單純「QR」（交易所分享卡、註冊 QR）不算；要明講 LINE／加好友／加群／網址才算。
const IMAGE_LINK = /LINE|賴|加好友|加群|入群|群組|社群邀請|網址|網站|連結|短網址|水印|浮水印|http|www\.|\.(?:com|net|io|cc|run|me|tw|xyz|top|vip|link|ly)\b|掃碼.{0,4}(?:跟單|加|入)|私訊|聯繫|聯絡/i;
const DENIAL = /(?:未見|未發現|未出現|未包含|並未|沒有|沒看到|無任何|無|不含|並非|不是|非)[^，。；,.;！!？?]{0,40}/g;
const IMAGE_OUT = /廣告|新群|轉移|搬家|冒充|假冒|管理員|客服|中獎|領獎|娛樂城|博弈|兼職|貸款|色情/;

/** 看圖理由是否為「交易所／獲利截圖、沒附任何連結」。 */
export function exchangeImageNoLink(reason) {
  const r = String(reason ?? "");
  if (!EXCHANGE_IMAGE.test(r) || IMAGE_OUT.test(r)) return false;
  return !IMAGE_LINK.test(r.replace(DENIAL, " "));
}

/** 結果名稱裡帶冒充管理員／假群組的，不套用豁免（那些規則不動）。 */
export function outOfScopeNames(names = []) {
  return (names ?? []).some((n) => /管理員|假群組|新群|轉移|冒充|冒用|群組邀請|LINE 邀請|網址|短網址/.test(String(n)));
}
