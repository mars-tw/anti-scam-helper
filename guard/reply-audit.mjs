// 自動回覆內容去識別化保留（replyAudit）：預設關閉。
// 開啟後把每則自動回覆寫進 guard/logs/reply-audit-日期.jsonl（時間、群雜湊、去識別化回覆與問題）。
// 不存暱稱、成員 ID、原始群 ID；超過 maxAgeDays（預設 7）的檔在啟動時與每日固定時間刪掉。
// 這些檔不進 git、不進每日備份、不外傳。
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const REPLY_AUDIT_DEFAULTS = {
  enabled: false,
  maxAgeDays: 7,
  /** 台北時間幾點執行每日清除（0–23）。 */
  purgeHour: 3,
};

const SALT_NAME = ".reply-audit-salt";
const FILE_RE = /^reply-audit-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** 全形數字 → 半形，方便對抗「全形電話」測試。 */
export function halfwidthDigits(text) {
  return String(text ?? "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/**
 * 回覆稽核專用去識別化：電話、email、LINE ID（含 u/p/m/c 長 ID）、身分證、
 * 信用卡／帳號數字、@暱稱、網址查詢參數。暱稱與成員 ID 不另外存欄位。
 */
export function deidentifyForAudit(text) {
  let out = halfwidthDigits(text);
  // email
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/gi, "［email］");
  // 網址：保留路徑，遮掉 ? 之後的查詢參數
  out = out.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, "$1［參數略］");
  // LINE mid：u／p／m／c + 32 hex
  out = out.replace(/\b[upmc][0-9a-fA-F]{32}\b/g, "［LINE ID］");
  // LINE／賴 ID 敘述
  out = out.replace(/(?:line|賴)\s*(?:id|ＩＤ)?\s*[:：]?\s*@?[\w.-]{3,}/gi, "［LINE ID］");
  out = out.replace(/(?<![A-Za-z])id\s*[:：]\s*@?[\w.-]{3,}/gi, "［LINE ID］");
  // 身分證
  out = out.replace(/\b[A-Z][12]\d{8}\b/g, "［身分證］");
  // 手機（允許空格／連字號拆開；含 +886）
  out = out.replace(/(?<!\d)(?:\+?886[\s-]*)?0?9(?:[\s-]*\d){8}(?!\d)/g, "［電話］");
  // 市話
  out = out.replace(/(?<!\d)\(?0\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g, "［電話］");
  // 信用卡／帳號：10–19 位數字（可夾空格或連字號）
  out = out.replace(/(?<!\d)(?:\d[\s-]?){9,18}\d(?!\d)/g, "［帳號］");
  // @暱稱（不保留原文）
  out = out.replace(/@[^\s@]{1,40}/g, "［暱稱］");
  return out;
}

/** 台北日 YYYY-MM-DD（用 +08 偏移，不依賴主機 TZ）。 */
export function taipeiDateString(ms = Date.now()) {
  const offset = 8 * 3_600_000;
  const d = new Date(ms + offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 該台北日 0 點的 UTC ms。 */
export function taipeiDayStart(ms = Date.now()) {
  const offset = 8 * 3_600_000;
  return Math.floor((ms + offset) / 86_400_000) * 86_400_000 - offset;
}

export function loadOrCreateSalt(logDir) {
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  try { chmodSync(logDir, 0o700); } catch {}
  const path = join(logDir, SALT_NAME);
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(16).toString("hex"), { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch {}
  }
  return readFileSync(path, "utf8").trim();
}

export function chatHash(chatId, salt) {
  return createHash("sha256").update(`${salt}|chat:${chatId}`).digest("hex").slice(0, 16);
}

/**
 * 寫一筆去識別化稽核。呼叫端須先確認 enabled；本函式不再檢查開關。
 * @returns {string|null} 寫入的檔名，失敗回 null
 */
export function appendReplyAudit({ logDir, chatId, reply, question, at = new Date().toISOString(), salt } = {}) {
  if (!logDir || !chatId) return null;
  const useSalt = salt ?? loadOrCreateSalt(logDir);
  const day = taipeiDateString(Date.parse(at) || Date.now());
  const name = `reply-audit-${day}.jsonl`;
  const file = join(logDir, name);
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const entry = {
    at,
    chatHash: chatHash(chatId, useSalt),
    reply: deidentifyForAudit(reply),
    question: deidentifyForAudit(question),
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch {}
  return name;
}

/**
 * 刪掉超過 maxAgeDays 的 reply-audit-*.jsonl（依檔名日期，台北日）。
 * @returns {number} 刪掉幾個檔
 */
export function purgeReplyAuditFiles(logDir, { maxAgeDays = REPLY_AUDIT_DEFAULTS.maxAgeDays, now = Date.now() } = {}) {
  if (!logDir || !existsSync(logDir)) return 0;
  const cutoff = taipeiDayStart(now) - maxAgeDays * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(logDir)) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const dayStart = Date.parse(`${m[1]}T00:00:00+08:00`);
    if (!Number.isFinite(dayStart) || dayStart >= cutoff) continue;
    try {
      unlinkSync(join(logDir, name));
      removed++;
    } catch {}
  }
  return removed;
}

/** 距下一次台北 purgeHour:00 還有幾毫秒。 */
export function msUntilNextPurgeHour(purgeHour = REPLY_AUDIT_DEFAULTS.purgeHour, now = Date.now()) {
  const hour = ((Number(purgeHour) % 24) + 24) % 24;
  const offset = 8 * 3_600_000;
  const local = now + offset;
  const day = Math.floor(local / 86_400_000);
  let next = day * 86_400_000 + hour * 3_600_000 - offset;
  if (next <= now) next += 86_400_000;
  return next - now;
}

/** enabled 為 false 時完全不寫檔、不建 salt。 */
export function writeReplyAuditIfEnabled(cfg, args) {
  if (!cfg?.enabled) return null;
  return appendReplyAudit(args);
}
