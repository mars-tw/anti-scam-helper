// 斷線補掃：LINE 連線斷掉（主機暫停、服務重啟）期間貼的訊息，即時推播不會補送。
// 守衛每次連上（收到聊天室清單）就逐一抓各群最近的歷史訊息，把「上次看到的最新訊息之後、而且在 maxAge 內」
// 還沒處理過的訊息丟回一般流程（同樣的規則、地端模型、Meta 覆核與處置，不另外發訊息）。
// 每個聊天室記一個時間水位（最新看過的訊息時間）存檔；第一次（沒有水位）只建立基準、不補掃，避免把舊訊息全部重判。
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * 從一頁歷史訊息挑出要補掃的訊息。
 * @returns {{ toScan: object[], watermark: number | undefined }} watermark：處理完這頁後的新水位
 */
export function selectCatchUp(messages, { watermark, now = Date.now(), maxAgeMs, handled = new Set(), isSelf = () => false }) {
  let newest = watermark;
  for (const message of messages) if (Number.isFinite(message.createdAt) && (newest === undefined || message.createdAt > newest)) newest = message.createdAt;
  if (watermark === undefined) return { toScan: [], watermark: newest };
  const toScan = messages.filter((message) => Number.isFinite(message.createdAt)
    && message.createdAt > watermark
    && now - message.createdAt <= maxAgeMs
    && !handled.has(message.messageId)
    && !message.unsent
    && message.contentType !== "CHATEVENT"
    && !isSelf(message))
    .sort((a, b) => a.createdAt - b.createdAt);
  return { toScan, watermark: newest };
}

/** 各聊天室的時間水位，存成 JSON（權限 600）。只存聊天室 id 與時間，不存訊息內容。 */
export class Watermarks {
  constructor(file, { saveDelayMs = 5000 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.timer = undefined;
    try { this.map = new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))).filter(([, at]) => Number.isFinite(at))); } catch { this.map = new Map(); }
  }

  get(chatId) {
    return this.map.get(chatId);
  }

  /** 只往前推，不往回退。 */
  bump(chatId, at) {
    if (!chatId || !Number.isFinite(at)) return;
    const known = this.map.get(chatId);
    if (known !== undefined && known >= at) return;
    this.map.set(chatId, at);
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.save(); }, this.saveDelayMs);
    this.timer.unref?.();
  }

  save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(this.map)), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }
}
