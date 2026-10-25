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
 * 拿掉 @ 段落：mention 沒送成功時，不能留下「@名字」純文字（看起來像標到人、甚至像標到同名冒名者）。
 * 每個 mention 範圍連同後面一個空白一起刪掉，其餘文字不動。
 */
export function stripMentions(text, mentions = []) {
  let out = String(text ?? "");
  for (const m of [...mentions].sort((a, b) => b.start - a.start)) {
    let end = m.end;
    if (out[end] === " ") end += 1;
    out = out.slice(0, m.start) + out.slice(end);
  }
  return out.replace(/\n[ \t]+/g, "\n");
}

export const NOTICE_LABEL = "（AI代理）";
/** 守門員送進群的每則訊息結尾都帶（AI代理）；已經有就不重複加（加在結尾，不影響 @ 位置）。 */
export function withAgentLabel(text) {
  const body = String(text ?? "");
  return body.includes(NOTICE_LABEL) ? body : `${body.replace(/\s+$/, "")}${NOTICE_LABEL}`;
}

/**
 * 只留下 keep(userId) 為 true 的 @：其餘 @ 段落從文字刪掉，留下的 @ 位置跟著平移。
 * 原因：LINE 服務只准 @「最近在這個聊天室發過言」的人，只要有一個不符合，整則就回 INVALID_REQUEST。
 */
export function keepMentions(text, mentions = [], keep = () => true) {
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const dropped = sorted.filter((m) => !keep(m.userId));
  if (!dropped.length) return { text: String(text ?? ""), mentions: sorted };
  const out = stripMentions(text, dropped);
  const src = String(text ?? "");
  const kept = [];
  for (const m of sorted) {
    if (!keep(m.userId)) continue;
    const label = src.slice(m.start, m.end);
    const from = kept.length ? kept.at(-1).end : 0;
    const start = out.indexOf(label, from);
    if (start < 0) continue;
    kept.push({ ...m, start, end: start + label.length });
  }
  return { text: out, mentions: kept };
}

/**
 * 送出通知（同一則最多補送一次）：
 * 1. 先送「引用該則訊息＋@」（@ 只留 canMention 准的人，其他人名字整段拿掉）。
 * 2. 伺服器明確拒絕（INVALID_REQUEST／SEND_FAILED 等）才補送一次：拿掉所有 @（不留「@名字」純文字）；
 *    帶 @ 被拒（INVALID_REQUEST）時保留引用，否則（LINE 端 SEND_FAILED 或本來就沒 @）連引用一起拿掉。
 * 逾時（可能已送出）或限流就停，不補送，避免重複發。
 * @param send (frame) => Promise<reply>，reply.type 為 "sent" 或 "error"（含 code）
 */
export async function sendNotice(send, { chatId, text, mentions = [], replyTo, canMention }) {
  text = withAgentLabel(text);
  const plain = mentions.length ? stripMentions(text, mentions) : text;
  const first = canMention ? keepMentions(text, mentions, canMention) : { text, mentions };
  const frameOf = (body, ms, reply) => ({ type: "message:send", chatId, text: body, ...(ms.length ? { mentions: ms } : {}), ...(reply ? { replyTo: reply } : {}) });
  const tried = [];
  const attempt = async (frame) => {
    const answer = await send(frame);
    tried.push({ reply: Boolean(frame.replyTo), mentions: Boolean(frame.mentions), result: answer.type === "sent" ? "sent" : answer.code });
    return answer;
  };
  const firstFrame = frameOf(first.mentions.length ? first.text : plain, first.mentions, replyTo);
  let answer = await attempt(firstFrame);
  if (answer.type !== "sent" && answer.code !== "TIMEOUT" && answer.code !== "RATE_LIMITED") {
    const keepReply = Boolean(firstFrame.mentions) && answer.code === "INVALID_REQUEST" ? replyTo : undefined;
    const retry = frameOf(plain, [], keepReply);
    if (JSON.stringify(retry) !== JSON.stringify(firstFrame)) answer = await attempt(retry);
  }
  const last = tried.at(-1);
  return { answer, tried, replied: answer.type === "sent" && Boolean(last?.reply), mentioned: answer.type === "sent" && Boolean(last?.mentions) };
}

/** 通知要 @ 的對象：排除被判詐騙的人本人，以及暱稱含隱形／顯示不出來字元的人（冒名常見手法）。 */
export const INVISIBLE_NAME = /[\u2800\u3164\u115f\u1160\uffa0\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad\u034f\u180e]/;
export function safeMentionTargets(admins = [], { excludeIds = [] } = {}) {
  const skip = new Set(excludeIds.filter(Boolean));
  return admins.filter(([id, admin]) => id && !skip.has(id) && !INVISIBLE_NAME.test(String(admin?.name ?? "")));
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
