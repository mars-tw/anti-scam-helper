// 11/5 誤判審查 3、5：通知送出失敗（SEND_FAILED 等）與抓圖／檔失敗（MEDIA_FAILED）的日報列與告警（純函式＋小狀態，測試見 test/guard-misjudge-1105.test.mjs）。
// 日報列不含訊息本文、不含連結，只有群組代碼、訊息代碼、錯誤碼。

export const SEND_FAIL_ALERT_COUNT = 3;
export const SEND_FAIL_WINDOW_MS = 3_600_000;

/** 同一群 1 小時內失敗次數；達 SEND_FAIL_ALERT_COUNT 次（含）回 alert=true（同一小時窗只告警一次）。 */
export class SendFailTracker {
  constructor({ now = () => Date.now(), windowMs = SEND_FAIL_WINDOW_MS, alertCount = SEND_FAIL_ALERT_COUNT } = {}) {
    this.now = now; this.windowMs = windowMs; this.alertCount = alertCount;
    this.recent = new Map(); // chatId → [時間]
    this.alerted = new Map(); // chatId → 上次告警時間
    this.daily = new Map(); // "YYYY-MM-DD chatId" → 次數
  }
  note(chatId, day) {
    const now = this.now();
    const list = (this.recent.get(chatId) ?? []).filter((at) => now - at < this.windowMs);
    list.push(now);
    this.recent.set(chatId, list);
    const key = `${day} ${chatId}`;
    const dayCount = (this.daily.get(key) ?? 0) + 1;
    this.daily.set(key, dayCount);
    if (this.daily.size > 2000) this.daily.delete(this.daily.keys().next().value);
    let alert = false;
    if (list.length >= this.alertCount && now - (this.alerted.get(chatId) ?? -Infinity) >= this.windowMs) { alert = true; this.alerted.set(chatId, now); }
    return { hourCount: list.length, dayCount, alert };
  }
  /** 某一天每群的失敗次數（日報用）。 */
  dayCounts(day) {
    const out = {};
    for (const [key, n] of this.daily) { const [d, chatId] = key.split(" "); if (d === day) out[chatId] = n; }
    return out;
  }
}

/** 日報列：通知送出失敗（每次失敗一列）。replyExists：被引用的原訊息當下是否還在（true／false／undefined＝沒引用或查不到）。 */
export function sendFailReportLine({ at, chatId, messageId, kind, code, attempt, replied, replyExists, hourCount, dayCount } = {}) {
  if (!chatId || !code) return null;
  return JSON.stringify({ at: at ?? new Date().toISOString(), kind: "send-failed", chatId, ...(messageId != null ? { messageId } : {}), ...(kind ? { notice: kind } : {}), code: String(code).slice(0, 40), attempt, replied: Boolean(replied), ...(replyExists !== undefined ? { replyExists } : {}), ...(hourCount != null ? { hourCount } : {}), ...(dayCount != null ? { dayCount } : {}) });
}
export function sendFailAlertLine({ at, chatId, hourCount } = {}) {
  return JSON.stringify({ at: at ?? new Date().toISOString(), kind: "send-failed-alert", chatId, hourCount });
}
/** 日報列：抓圖／檔失敗後重抓一次的結果。 */
export function mediaFailReportLine({ at, chatId, messageId, frame, code, retryCode, recovered } = {}) {
  if (!chatId) return null;
  return JSON.stringify({ at: at ?? new Date().toISOString(), kind: "media-failed", chatId, ...(messageId != null ? { messageId } : {}), frame, code: String(code ?? "unknown").slice(0, 40), retried: true, recovered: Boolean(recovered), ...(recovered ? {} : { retryCode: String(retryCode ?? "unknown").slice(0, 40) }) });
}

/** 讀日報 jsonl 的各列，彙整成「每群 SEND_FAILED 次數／MEDIA_FAILED 次數（重抓成功幾次）」。day＝台北日期 YYYY-MM-DD（可省略＝全部）。 */
export function summarizeOpsReport(lines, { day, dayOf = (iso) => iso?.slice(0, 10) } = {}) {
  const send = {}; const media = {}; const alerts = {};
  for (const raw of lines ?? []) {
    let row; try { row = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
    if (!row?.chatId || (day && dayOf(row.at) !== day)) continue;
    if (row.kind === "send-failed") send[row.chatId] = (send[row.chatId] ?? 0) + 1;
    else if (row.kind === "send-failed-alert") alerts[row.chatId] = (alerts[row.chatId] ?? 0) + 1;
    else if (row.kind === "media-failed") { const m = media[row.chatId] ??= { failed: 0, recovered: 0 }; m.failed++; if (row.recovered) m.recovered++; }
  }
  return { sendFailedByChat: send, sendFailAlertsByChat: alerts, mediaFailedByChat: media };
}

/** 抓圖／檔：失敗（MEDIA_FAILED、TIMEOUT 等，NOT_FOUND 除外）等 delayMs 後重抓一次；回傳 { answer, retried, first }。 */
export async function fetchWithRetry(call, frame, { okType, delayMs = 1500, sleep = (ms) => new Promise((d) => setTimeout(d, ms)) } = {}) {
  const first = await call(frame);
  if (first?.type === okType || first?.code === "NOT_FOUND") return { answer: first, retried: false, first };
  await sleep(delayMs);
  const second = await call(frame);
  return { answer: second, retried: true, first };
}
