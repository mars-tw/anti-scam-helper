// 守衛通知的共用工具（純函式，測試見 test/guard-notice.test.mjs）。
// - 通知一律「回覆」那則詐騙訊息（LINE 的引用回覆），大家一看就知道是哪一則。
// - LINE 群組可能設了禁止關鍵字（例如「換群」）：含禁字的訊息 LINE 會收下但不給別人看，所以送出前先替換掉。
// - 不引用詐騙者的訊息內容；暱稱是對方取的，也去掉網址、LINE ID 與禁字再放進通知。

export const DEFAULT_BLOCKED_WORDS = { 換群: "假群組" };

/** 把禁字換成安全的說法。blockedWords：{ 禁字: 替代字 } 或 [禁字…]（陣列時換成「＊」）。 */
export function scrubNotice(text, blockedWords = DEFAULT_BLOCKED_WORDS) {
  const pairs = Array.isArray(blockedWords) ? blockedWords.map((word) => [word, "＊"]) : Object.entries(blockedWords ?? {});
  let out = String(text ?? "");
  for (const [word, replacement] of pairs) {
    if (!word) continue;
    // 也抓用空白拆開的寫法（「換 群」）。
    const spaced = [...word].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\u3000]*");
    out = out.replace(new RegExp(spaced, "g"), replacement);
  }
  return out;
}

/** 通知裡的暱稱：去掉網址、LINE ID 樣式、換行，最多 20 字，再過禁字。 */
export function safeName(name, blockedWords = DEFAULT_BLOCKED_WORDS) {
  const cleaned = String(name ?? "").normalize("NFKC")
    .replace(/(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?/gi, "")
    .replace(/@?[\w.-]*\d[\w.-]{4,}/g, "")
    .replace(/[\r\n\t]+/g, " ").trim().slice(0, 20);
  return scrubNotice(cleaned, blockedWords) || "某位成員";
}

/**
 * 送出通知：先「回覆該則訊息＋@」，失敗就依序退成「只回覆」「只 @」「純文字」。
 * 只有伺服器明確拒絕（沒送出）才退一步；逾時（可能已送出）或限流就停，避免重複發。
 * @param send (frame) => Promise<reply>，reply.type 為 "sent" 或 "error"（含 code）
 */
export async function sendNotice(send, { chatId, text, mentions = [], replyTo }) {
  const attempts = [];
  const add = (withReply, withMentions) => {
    if (withReply && !replyTo) return;
    if (withMentions && !mentions.length) return;
    const frame = { type: "message:send", chatId, text, ...(withMentions ? { mentions } : {}), ...(withReply ? { replyTo } : {}) };
    if (!attempts.some((known) => JSON.stringify(known) === JSON.stringify(frame))) attempts.push(frame);
  };
  add(true, true); add(true, false); add(false, true); add(false, false);
  let answer = { type: "error", code: "NOT_SENT" };
  const tried = [];
  for (const frame of attempts) {
    answer = await send(frame);
    tried.push({ reply: Boolean(frame.replyTo), mentions: Boolean(frame.mentions), result: answer.type === "sent" ? "sent" : answer.code });
    if (answer.type === "sent" || answer.code === "TIMEOUT" || answer.code === "RATE_LIMITED") break;
  }
  return { answer, tried, replied: answer.type === "sent" && Boolean(tried.at(-1)?.reply) };
}

/**
 * 先通知、再處置：notify() 送出通知（引用那則訊息），等 delayMs，再 act(notified) 刪訊息／踢人。
 * 通知失敗也照樣處置（不能因為發不出通知就放著詐騙訊息）；回傳通知是否送出。
 */
export async function notifyThenAct(notify, act, delayMs = 2000, sleep = (ms) => new Promise((done) => setTimeout(done, ms))) {
  let notified = false;
  try { notified = Boolean(await notify()); } catch { notified = false; }
  await sleep(delayMs);
  await act(notified);
  return notified;
}
