// 社群記事本（OpenChat note）巡查：記事本貼文不是聊天訊息，不會從訊息流進來，
// 守衛定期（連線、醒來補掃、記事本變動通知、固定間隔）讀最近的記事本，走同一套判斷。
// 這裡只放純函式與已看過清單，方便測試；連線與送通知在 guard.mjs。
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { scrubNotice } from "./notice.mjs";

export const NOTE_DEFAULTS = {
  enabled: true,
  intervalMinutes: 15,
  limit: 20,
  /** 只處理多久以內建立／更新的記事本（較舊的只記錄不通知）。 */
  maxAgeHours: 48,
  /** 刪除記事本：服務端目前沒有刪除記事本的 API，預設關閉；開了也只在管理員群、地端與 Meta 都判 SCAM 時才會嘗試。 */
  deleteOnConfirmed: false,
  seenFile: "notes-seen.json",
  maxSeen: 2000,
};

/** 一則記事本的版本鍵：同一篇被編輯過（updatedAt 變了）要重新判斷。 */
export const noteKey = (chatId, note) => `${chatId} ${note.postId} ${note.updatedAt ?? note.createdAt}`;

/** 已看過的記事本（只存聊天室 id、貼文 id、時間），檔案 600。baseline：第一次啟用的時間，之前的貼文只記錄不通知。 */
export class NotesSeen {
  constructor(file, { maxSeen = 2000, now = Date.now } = {}) {
    this.file = file;
    this.maxSeen = maxSeen;
    let data = {};
    try { data = JSON.parse(readFileSync(file, "utf8")); } catch { data = {}; }
    this.baseline = Number.isFinite(data.baseline) ? data.baseline : now();
    this.keys = new Map(Object.entries(data.keys ?? {}).filter(([, at]) => Number.isFinite(at)));
    if (!Number.isFinite(data.baseline)) this.save();
  }
  has(key) { return this.keys.has(key); }
  add(key, at = Date.now()) {
    this.keys.set(key, at);
    while (this.keys.size > this.maxSeen) this.keys.delete(this.keys.keys().next().value);
    this.save();
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ baseline: this.baseline, keys: Object.fromEntries(this.keys) }), { mode: 0o600 });
      renameSync(tmp, this.file);
      chmodSync(this.file, 0o600);
    } catch { /* 存不了只影響重啟後重判 */ }
  }
}

/** 記事本內文給規則與模型用：記事本常用「字 字 字」空格排版，把中日韓字之間的空白拿掉（網址不動）。 */
export function noteText(text) {
  return String(text ?? "")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/([\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])[ \t\u3000]+(?=[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])/g, "$1")
    .replace(/[ \t\u3000]{2,}/g, " ")
    .trim();
}

/**
 * 通知裡引用的去識別化片段：拿掉網址／網域、LINE ID、電話、email、@提及，禁字換掉，最多 maxChars 字。
 * 讓大家認得是哪一篇記事本，但不把詐騙連結或聯絡方式再貼一次。
 */
export function noteSnippet(text, blockedWords, maxChars = 30) {
  let t = noteText(text)
    .replace(/https?:\/\/\S+/gi, "〔連結〕")
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?/gi, "〔連結〕")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "〔email〕")
    .replace(/(line|賴)\s*(id|ＩＤ)?\s*[:：]?\s*@?[\w.-]{3,}/gi, "〔ID〕")
    .replace(/@\S+/g, "")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "〔電話〕")
    .replace(/(〔連結〕\s*)+/g, "〔連結〕")
    .replace(/\s+/g, " ")
    .trim();
  if ([...t].length > maxChars) t = `${[...t].slice(0, maxChars).join("")}…`;
  return scrubNotice(t, blockedWords);
}

/**
 * 記事本的處置（比照訊息，但記事本無法用訊息 id 踢人，所以沒有 kick）：
 * - notify：規則 ≥ notifyScore 且 Meta 判 SCAM；或 Meta 不可用時規則 ≥ strongScore（只通知）。
 * - delete：另外還要 deleteOnConfirmed、管理員群（canDelete）、服務支援（deleteSupported）、地端與 Meta 都判 SCAM、規則 ≥ notifyScore。
 * - protectedAuthor（管理員、受保護成員、本帳號）：一律 none。
 */
export function decideNoteAction({ score, verdict, review, strongScore = 6, notifyScore = 3, protectedAuthor = false, deleteOnConfirmed = false, canDelete = false, deleteSupported = false }) {
  if (protectedAuthor) return "none";
  const metaDown = review === undefined || review === "UNAVAILABLE";
  const confirmed = review === "SCAM" && score >= notifyScore;
  if (confirmed && verdict === "SCAM" && deleteOnConfirmed && canDelete && deleteSupported) return "delete";
  if (confirmed) return "notify";
  if (metaDown && score >= strongScore) return "notify";
  return "none";
}

/** 記事本通知文字（聊天室裡發，不能引用記事本）：片段＋請管理員處理；@ 群主／管理員。 */
export function buildNoteNotice({ snippet, reason = "", authorName, admins = [], deleting = false }, blockedWords) {
  const who = authorName ? `「${authorName}」` : "有人";
  let text = `⚠️ 反詐小幫手（AI代理）：記事本裡${who}的貼文疑似詐騙${reason}：「${snippet}」\n`;
  text += deleting ? "將刪除這篇記事本。" : "本帳號無法處理記事本，請群主／管理員確認後刪除。";
  text += "\n社群不會因為「廣告太多」要大家搬到新群，請不要點記事本裡的連結、不要加入陌生群組。";
  const mentions = [];
  if (admins.length > 0) {
    text += "\n";
    for (const [id, admin] of admins) {
      const label = `@${admin.name}`;
      mentions.push({ userId: id, start: text.length, end: text.length + label.length });
      text += `${label} `;
    }
    text += admins.some(([, a]) => a.role === "admin") ? "請群主與管理員留意" : "請管理員留意";
  }
  // 換禁字不能改變 @ 的位置：只在 @ 之前的部分換字（名字已先處理過）。
  const cut = mentions.length ? mentions[0].start : text.length;
  const head = scrubNotice(text.slice(0, cut), blockedWords);
  const shift = head.length - cut;
  return { text: head + text.slice(cut), mentions: mentions.map((m) => ({ ...m, start: m.start + shift, end: m.end + shift })) };
}
