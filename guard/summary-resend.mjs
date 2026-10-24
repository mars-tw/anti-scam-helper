// /ai整理 補發佇列：整理已產生但送出 LINE 失敗（逾時、斷線、服務重啟）時暫存在本機（data/，600，不進 git），
// LINE 重新可用後依原順序補發。不重複：每次整理有唯一 id，每則最多成功一次；補發前先從伺服器抓該群最近訊息比對，
// 已出現（逾時其實送到了）就視為成功、不再發。狀態每步寫檔，重啟後不會重發已成功的那則。
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const RESEND_DEFAULTS = { ttlMs: 30 * 60_000, maxAttempts: 5 };

const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** 伺服器歷史裡是否已有本帳號在 since 之後發過同一段文字。 */
export function alreadyDelivered(text, messages, { me, isMine = (m) => m.senderId === me, since = 0, textOf = (m) => m.text } = {}) {
  const want = norm(text);
  if (!want) return false;
  return (messages ?? []).some((m) => !m.unsent && (m.createdAt ?? Infinity) >= since - 60_000 && isMine(m) && norm(textOf(m)) === want);
}

export class SummaryResendQueue {
  constructor(file, { now = Date.now, ttlMs = RESEND_DEFAULTS.ttlMs, maxAttempts = RESEND_DEFAULTS.maxAttempts } = {}) {
    this.file = file; this.now = now; this.ttlMs = ttlMs; this.maxAttempts = maxAttempts;
    try { this.data = JSON.parse(readFileSync(file, "utf8")); } catch { this.data = { jobs: [] }; }
    if (!Array.isArray(this.data.jobs)) this.data.jobs = [];
    this.busy = false;
  }
  /** parts：[{ section, role, text }] 依送出順序；sent：每則是否已確認送出。 */
  add({ chatId, replyTo, parts, sent, committed = false, id = randomUUID() }) {
    const job = { id, chatId, replyTo, createdAt: this.now(), expiresAt: this.now() + this.ttlMs, attempts: 0, committed,
      parts: parts.map((p, i) => ({ section: p.section, role: p.role, text: p.text, sent: Boolean(sent?.[i]) })) };
    if (job.parts.every((p) => p.sent)) return undefined;
    this.data.jobs.push(job); this.save();
    return job;
  }
  jobs() { return this.data.jobs; }
  has(chatId) { return this.data.jobs.some((j) => j.chatId === chatId); }
  remove(id) { this.data.jobs = this.data.jobs.filter((j) => j.id !== id); this.save(); }
  /** 只保留今天以後（cutoff 以後建立）的：上線前就失敗的整理一律不撿。 */
  dropBefore(cutoff) { const before = this.data.jobs.length; this.data.jobs = this.data.jobs.filter((j) => j.createdAt >= cutoff); if (before !== this.data.jobs.length) this.save(); return before - this.data.jobs.length; }

  /**
   * 跑一輪補發。deps：
   *  allowed(chatId) → 這群能不能發（只學習／禁止發送的群回 false，整份丟棄）
   *  fetchRecent(chatId) → 伺服器最近訊息陣列；失敗回 undefined（這輪不動，避免盲發）
   *  delivered(text, messages, since) → 是否已送達
   *  send(job, part) → true＝送出成功
   *  onCommit(job)：主整理第一次確認送達時呼叫（開始冷卻）
   *  log(entry)
   */
  async run({ allowed, fetchRecent, delivered, send, onCommit = () => {}, log = () => {} }) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const job of [...this.data.jobs]) {
        if (!allowed(job.chatId)) { log({ action: "ai-summary-resend-dropped", chatId: job.chatId, jobId: job.id, reason: "not-allowed" }); this.remove(job.id); continue; }
        if (this.now() > job.expiresAt || job.attempts >= this.maxAttempts) {
          log({ action: "ai-summary-resend-expired", chatId: job.chatId, jobId: job.id, attempts: job.attempts, unsent: job.parts.filter((p) => !p.sent).length });
          this.remove(job.id); continue;
        }
        const recent = await fetchRecent(job.chatId);
        if (!Array.isArray(recent)) { log({ action: "ai-summary-resend-wait", chatId: job.chatId, jobId: job.id, reason: "history-unavailable" }); continue; }
        job.attempts++; this.save();
        let failed = false;
        for (const [index, part] of job.parts.entries()) {
          if (part.sent) continue;
          // 主整理一則都沒送到時，附加整理不送（和第一次送出規則一樣）。
          if (part.role !== "primary" && !job.parts.some((p) => p.role === "primary" && p.sent)) { failed = true; break; }
          if (delivered(part.text, recent, job.createdAt)) { part.sent = true; this.save(); log({ action: "ai-summary-resend-found", chatId: job.chatId, jobId: job.id, index }); }
          else if (await send(job, part)) { part.sent = true; this.save(); log({ action: "ai-summary-resent", chatId: job.chatId, jobId: job.id, index }); }
          else { failed = true; break; }
          if (part.role === "primary" && !job.committed) { job.committed = true; this.save(); onCommit(job); }
        }
        if (!failed && job.parts.every((p) => p.sent)) { log({ action: "ai-summary-resend-done", chatId: job.chatId, jobId: job.id, attempts: job.attempts }); this.remove(job.id); }
      }
    } finally { this.busy = false; }
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file); chmodSync(this.file, 0o600);
    } catch { /* 寫不了：最壞只是重啟後不補發 */ }
  }
}
