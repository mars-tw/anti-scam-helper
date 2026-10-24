import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SummaryResendQueue, alreadyDelivered } from "../guard/summary-resend.mjs";
import { SummaryState } from "../guard/ai-summary.mjs";

const file = () => join(mkdtempSync(join(tmpdir(), "resend-")), "q.json");
const parts = [{ section: "strategy", role: "primary", text: "A（AI代理）" }, { section: "chat", role: "followup", text: "B（AI代理）" }];
function deps(over = {}) {
  const sent = [];
  const logs = [];
  return { sent, logs, d: { allowed: () => true, fetchRecent: async () => [], delivered: (t, msgs, since) => alreadyDelivered(t, msgs, { me: "me", since }),
    send: async (job, p) => { sent.push(p.text); return true; }, onCommit: () => {}, log: (e) => logs.push(e), ...over } };
}

test("補發依原順序送出未送的兩則，完成後移除；檔案 600", async () => {
  const f = file(); const q = new SummaryResendQueue(f);
  q.add({ chatId: "c", parts, sent: [false, false] });
  assert.equal(statSync(f).mode & 0o777, 0o600);
  let commits = 0; const { sent, d } = deps({ onCommit: () => commits++ });
  await q.run(d);
  assert.deepEqual(sent, ["A（AI代理）", "B（AI代理）"]); assert.equal(commits, 1); assert.equal(q.jobs().length, 0);
});

test("已成功的那則不重發；主整理已送也不再 commit", async () => {
  const q = new SummaryResendQueue(file()); q.add({ chatId: "c", parts, sent: [true, false], committed: true });
  let commits = 0; const { sent, d } = deps({ onCommit: () => commits++ }); await q.run(d);
  assert.deepEqual(sent, ["B（AI代理）"]); assert.equal(commits, 0);
});

test("逾時其實送到了：伺服器已出現同文字就視為成功、不補發", async () => {
  let t = 1000; const q = new SummaryResendQueue(file(), { now: () => t }); q.add({ chatId: "c", parts, sent: [false, false] });
  t = 2000;
  const { sent, d } = deps({ fetchRecent: async () => [{ senderId: "me", createdAt: 1500, text: "A（AI代理）" }, { senderId: "x", createdAt: 1600, text: "B（AI代理）" }] });
  await q.run(d);
  assert.deepEqual(sent, ["B（AI代理）"]); // 別人貼同文字不算
});

test("抓不到伺服器歷史就不盲發", async () => {
  const q = new SummaryResendQueue(file()); q.add({ chatId: "c", parts, sent: [false, false] });
  const { sent, d } = deps({ fetchRecent: async () => undefined }); await q.run(d);
  assert.deepEqual(sent, []); assert.equal(q.jobs().length, 1); assert.equal(q.jobs()[0].attempts, 0);
});

test("主整理補發失敗：附加整理不送，保留等下次", async () => {
  const q = new SummaryResendQueue(file()); q.add({ chatId: "c", parts, sent: [false, false] });
  const { sent, d } = deps({ send: async (j, p) => { sent.push(p.text); return false; } }); await q.run(d);
  assert.deepEqual(sent, ["A（AI代理）"]); assert.equal(q.jobs().length, 1);
});

test("狀態寫磁碟：重啟後不重發已成功那則", async () => {
  const f = file(); const q = new SummaryResendQueue(f); q.add({ chatId: "c", parts, sent: [false, false] });
  await q.run(deps({ send: async (j, p) => p.role === "primary" }).d);
  const q2 = new SummaryResendQueue(f);
  assert.deepEqual(q2.jobs()[0].parts.map((p) => p.sent), [true, false]);
  const { sent, d } = deps(); await q2.run(d); assert.deepEqual(sent, ["B（AI代理）"]);
});

test("過期（30 分鐘）或超過次數就放棄並記錄", async () => {
  let t = 0; const q = new SummaryResendQueue(file(), { now: () => t, maxAttempts: 2 }); q.add({ chatId: "c", parts, sent: [false, false] });
  t = 31 * 60_000; const { sent, logs, d } = deps(); await q.run(d);
  assert.deepEqual(sent, []); assert.equal(q.jobs().length, 0); assert.equal(logs[0].action, "ai-summary-resend-expired");
  t = 0; q.add({ chatId: "c", parts, sent: [false, false] });
  const fail = deps({ send: async () => false });
  await q.run(fail.d); await q.run(fail.d); await q.run(fail.d);
  assert.equal(q.jobs().length, 0); assert.equal(fail.logs.at(-1).action, "ai-summary-resend-expired");
});

test("只學習或禁止發送的群：整份丟棄、絕不補發", async () => {
  const q = new SummaryResendQueue(file()); q.add({ chatId: "bear", parts, sent: [false, false] });
  const { sent, logs, d } = deps({ allowed: (c) => c !== "bear" }); await q.run(d);
  assert.deepEqual(sent, []); assert.equal(q.jobs().length, 0); assert.equal(logs[0].reason, "not-allowed");
});

test("全部已送就不入佇列；沒有檔案時佇列為空（舊的失敗整理不會被撿）", () => {
  const f = file(); const q = new SummaryResendQueue(f);
  assert.equal(q.add({ chatId: "c", parts, sent: [true, true] }), undefined); assert.equal(existsSync(f), false); assert.equal(q.jobs().length, 0);
  const a = q.add({ chatId: "c", parts, sent: [false, false] }); const b = q.add({ chatId: "c", parts, sent: [false, false] });
  assert.notEqual(a.id, b.id);
  assert.ok(!readFileSync(f, "utf8").includes("token"));
});

test("同時只跑一輪（避免並行重複發）", async () => {
  const q = new SummaryResendQueue(file()); q.add({ chatId: "c", parts, sent: [false, false] });
  const { sent, d } = deps({ send: async (j, p) => { await new Promise((r) => setTimeout(r, 10)); sent.push(p.text); return true; } });
  await Promise.all([q.run(d), q.run(d)]); assert.equal(sent.length, 2);
});

test("SummaryState.commitAt 補發成功才開始冷卻", () => {
  let t = 10_000_000; const s = new SummaryState(file(), { now: () => t });
  assert.equal(s.check("c", 600_000).ok, true); s.commitAt("c"); t += 60_000;
  assert.equal(s.check("c", 600_000).ok, false); t += 600_000; assert.equal(s.check("c", 600_000).ok, true);
});
