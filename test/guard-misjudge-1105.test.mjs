// 11/5 誤判審查修正：1 處置前不預告「將移出」、2 貨到付款不走溫和提醒、3 SEND_FAILED 記錄／退避／@ 上限／告警／日報、
// 4 短網址展開正常不加 6 分、5 MEDIA_FAILED 重抓一次。群組 ID、暱稱全是假的。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "../guard/node_modules/ws/wrapper.mjs";
import { sendNotice, MAX_NOTICE_MENTIONS } from "../guard/notice.mjs";
import { shopPageOnlyReviewOk } from "../guard/shop.mjs";
import { shortUrlNormalLanding, shortUrlExpandOutcome } from "../guard/short-url-outcome.mjs";
import { SendFailTracker, fetchWithRetry, mediaFailReportLine, sendFailReportLine, summarizeOpsReport } from "../guard/ops-report.mjs";

const SWAP = "通知：本群明天要刪除了，請大家加入新群 https://line.me/ti/g2/FakeGroup0001 快點";
const WILL = /將移出|將把|將刪除/;

async function runGuard(extraConfig, live, { history = [], waitMs = 2600, respond = {} } = {}) {
  const llm = createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "SCAM\n測試" } }] })); }); });
  await new Promise((done) => llm.listen(0, "127.0.0.1", done));
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((done) => wss.on("listening", done));
  const frames = [];
  let seq = 0;
  const chats = ["cKickTest", "cPlainTest", "cWarnOnlyTest", "cExcludedTest", "cLearnTest"];
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "auth:ready", profile: { userId: "uMe", displayName: "bot" } }));
    socket.send(JSON.stringify({ type: "channels", channels: chats.map((channelId) => ({ channelId, name: "測試群", kind: "square" })) }));
    socket.on("message", (data) => {
      const f = JSON.parse(data.toString());
      frames.push(f);
      const custom = respond[f.type]?.(f, frames);
      if (custom) return socket.send(JSON.stringify({ requestId: f.requestId, ...custom }));
      if (f.type === "history:fetch") socket.send(JSON.stringify({ type: "history", requestId: f.requestId, chatId: f.chatId, messages: history.filter((m) => m.channelId === f.chatId), hasMore: false }));
      else if (f.type === "message:send") socket.send(JSON.stringify({ type: "sent", requestId: f.requestId, messageId: `sent${++seq}` }));
      else if (f.type === "member:remove") socket.send(JSON.stringify({ type: "member:removed", requestId: f.requestId, chatId: f.chatId, messageId: f.messageId, memberId: "x", messageDeleted: true }));
      else if (f.type === "message:delete") socket.send(JSON.stringify({ type: "message:deleted", requestId: f.requestId }));
      else if (f.type === "invite:own") socket.send(JSON.stringify({ type: "invite:own", requestId: f.requestId, chatId: f.chatId, links: [] }));
      else if (f.type === "invite:lookup") socket.send(JSON.stringify({ type: "invite:lookup", requestId: f.requestId, chatId: f.chatId, found: false }));
      else if (f.requestId) socket.send(JSON.stringify({ type: "error", requestId: f.requestId, code: "NOT_FOUND" }));
    });
    setTimeout(() => { for (const m of live) socket.send(JSON.stringify({ type: "message", message: { contentType: "NONE", channelKind: "square", createdAt: Date.now(), ...m } })); }, 600);
  });
  const dir = mkdtempSync(join(tmpdir(), "guard-1105-"));
  const model = { backend: "openai", baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: "claude-fake", apiKeyEnv: "" };
  const config = {
    dryRun: false, localScreenAll: true, kickPolicy: "strict", strongScore: 6, reviewScore: 3, notifyScore: 3, deleteMessage: true, kickMode: "notify",
    llm: model, review: model, patterns: { enabled: false }, qr: { enabled: false }, logDir: join(dir, "logs"),
    notify: { enabled: true, chats, cooldownSeconds: 0, beforeActionMs: 10, retryDelayMs: 10, backoffMs: 10 }, scamLink: { deleteOnConfirmed: true },
    catchUp: { scanMinutes: 0 }, knowledge: { enabled: false, prefetch: false }, mediaRetryDelayMs: 10,
    groupPolicies: { cKickTest: { kickMode: "kick" }, cPlainTest: { kickMode: "notify" }, cWarnOnlyTest: { warnOnly: true }, cLearnTest: { learnOnly: true } },
    kickScope: { excludeChats: ["cExcludedTest"] },
    ...extraConfig,
  };
  writeFileSync(join(dir, "guard.config.json"), JSON.stringify(config));
  const child = spawn(process.execPath, ["guard/guard.mjs", join(dir, "guard.config.json")], { env: { ...process.env, LINEJS_TOKEN: "test", GUARD_NO_KICK_FILE: join(dir, "no-GUARD_NO_KICK"), GUARD_NO_KICK_CHATS_FILE: join(dir, "no-GUARD_NO_KICK_CHATS"), LINEJS_URL: `ws://127.0.0.1:${wss.address().port}` }, stdio: "ignore" });
  await new Promise((done) => setTimeout(done, waitMs));
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done));
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))]);
  wss.close(); llm.close();
  const opsFile = join(dir, "logs", "ops-failures.jsonl");
  const ops = existsSync(opsFile) ? readFileSync(opsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (process.env.GUARD_1105_DEBUG) { const { readdirSync } = await import("node:fs"); for (const f of readdirSync(join(dir, "logs"))) if (f.startsWith("guard-")) console.error(readFileSync(join(dir, "logs", f), "utf8").split("\n").map((l) => { try { const o = JSON.parse(l); return `${o.action} ${o.reason ?? ""} ${o.code ?? ""} ${o.kind ?? ""}`; } catch { return ""; } }).join("\n")); }
  rmSync(dir, { recursive: true, force: true });
  return { frames, ops, removes: frames.filter((f) => f.type === "member:remove"), deletes: frames.filter((f) => f.type === "message:delete"), sends: frames.filter((f) => f.type === "message:send") };
}
const texts = (r) => r.sends.map((f) => f.text ?? "");
const IMP_ADMIN = [{ messageId: "h1", channelId: "cPlainTest", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "大家好", createdAt: Date.now() - 60_000 }];
const IMP = { messageId: "m1", channelId: "cPlainTest", senderId: "pImp", senderName: "阿明", text: SWAP };
const SELF_ADMIN = (chatId) => [{ messageId: "h0", channelId: chatId, senderId: "uMe", senderName: "bot", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "嗨", createdAt: Date.now() - 60_000 }];

// ── 1 處置前不預告 ──
test("1 踢人群：沒有管理權（notAdmin）→ 不發「將移出」，照試踢；成功才發「已移出」", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cKickTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(r.removes.length, 1);
  assert.ok(texts(r).every((t) => !WILL.test(t)), JSON.stringify(texts(r)));
  assert.equal(r.sends.length, 1, JSON.stringify(texts(r)));
  assert.match(r.sends[0].text, /已將「陌生人」移出社群/);
  assert.equal(r.sends[0].replyTo, undefined, "原訊息已刪，不引用");
});

test("1 踢人群：有管理權 → 先發中性「處理中」，移出成功後再發「已移出」", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cKickTest", senderId: "pBad", senderName: "陌生人", text: SWAP }], { history: SELF_ADMIN("cKickTest") });
  assert.equal(r.removes.length, 1);
  assert.ok(texts(r).every((t) => !WILL.test(t)), JSON.stringify(texts(r)));
  assert.equal(r.sends.length, 2, JSON.stringify(texts(r)));
  assert.match(r.sends[0].text, /疑似詐騙.*處理中/);
  assert.match(r.sends[1].text, /已將「陌生人」移出社群/);
  const removeAt = r.frames.indexOf(r.removes[0]);
  assert.ok(r.frames.indexOf(r.sends[1]) > removeAt, "「已移出」在踢人之後");
});

test("1 踢人群：移出失敗 → 只發一則「無法移除，請管理員處理」", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cKickTest", senderId: "pBad", senderName: "陌生人", text: SWAP }], { respond: { "member:remove": () => ({ type: "error", code: "NO_PERMISSION", message: "x" }) } });
  assert.equal(r.removes.length, 1);
  assert.equal(r.sends.length, 1, JSON.stringify(texts(r)));
  assert.match(r.sends[0].text, /無法移除.*請管理員處理/);
  assert.ok(!WILL.test(r.sends[0].text) && !/已將/.test(r.sends[0].text));
});

test("1 非踢人群：換群邀請只通知，不踢不刪，不出現「將移出」", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cPlainTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(r.removes.length + r.deletes.length, 0);
  assert.ok(r.sends.length >= 1);
  assert.ok(texts(r).every((t) => !WILL.test(t)), JSON.stringify(texts(r)));
});

test("1 非踢人群：冒名＋邀請刪文（沒權限）→ 不預告，刪成功發「已刪除」", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: false } }, [IMP], { history: IMP_ADMIN });
  assert.equal(r.removes.length, 0);
  assert.equal(r.deletes.length, 1);
  assert.ok(texts(r).every((t) => !WILL.test(t)), JSON.stringify(texts(r)));
  assert.equal(r.sends.length, 1, JSON.stringify(texts(r)));
  assert.match(r.sends[0].text, /已刪除「阿明」的疑似詐騙訊息/);
});

test("1 非踢人群：有權限 → 先「處理中」再「已刪除」", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: false } }, [IMP], { history: [...IMP_ADMIN, ...SELF_ADMIN("cPlainTest")] });
  assert.equal(r.deletes.length, 1);
  assert.deepEqual(r.sends.map((f) => /處理中/.test(f.text) ? "pending" : /已刪除/.test(f.text) ? "done" : "other"), ["pending", "done"], JSON.stringify(texts(r)));
});

test("1 非踢人群：刪除失敗 → 只發一則「無法刪除」", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: false } }, [IMP], { history: IMP_ADMIN, respond: { "message:delete": () => ({ type: "error", code: "NO_PERMISSION" }) } });
  assert.equal(r.deletes.length, 1);
  assert.equal(r.sends.length, 1, JSON.stringify(texts(r)));
  assert.match(r.sends[0].text, /無法刪除/);
});

test("1 Hao0321 只警告群：不踢不刪，只警告，不出現「將移出」", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cWarnOnlyTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(r.removes.length + r.deletes.length, 0);
  assert.ok(r.sends.length >= 1);
  assert.ok(texts(r).every((t) => !WILL.test(t) && !/已將|已刪除/.test(t)), JSON.stringify(texts(r)));
});

test("1 排除群（熊群類）與學習群：不踢；學習群完全不發", async () => {
  const ex = await runGuard({}, [{ messageId: "m1", channelId: "cExcludedTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(ex.removes.length, 0);
  assert.ok(texts(ex).every((t) => !WILL.test(t)));
  const learn = await runGuard({}, [{ messageId: "m1", channelId: "cLearnTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(learn.removes.length + learn.deletes.length + learn.sends.length, 0);
});

test("1 試跑：只說「測試模式，未實際移除」", async () => {
  const r = await runGuard({ dryRun: true }, [{ messageId: "m1", channelId: "cKickTest", senderId: "pBad", senderName: "陌生人", text: SWAP }]);
  assert.equal(r.removes.length, 0);
  assert.ok(texts(r).every((t) => !WILL.test(t)));
});

test("1 處置不放寬：buildNotice 不再有「將移出／將刪除」字樣", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function buildNotice"), src.indexOf("11/5 誤判審查 1：處置前的預告"));
  assert.ok(!/將把|將移出|將刪除/.test(body));
  assert.match(body, /測試模式，未實際移除/);
});

// ── 2 貨到付款 ──
test("2 shopPageOnlyReviewOk：有「頁面：貨到付款」就不走溫和提醒（反例）", () => {
  const ok = (signals) => shopPageOnlyReviewOk({ level: "unsure", signals }, "OK");
  assert.equal(ok(["頁面：貨到付款"]), false);
  assert.equal(ok(["頁面：一頁式", "頁面：貨到付款"]), false);
  assert.equal(ok(["頁面：單頁訂購表單", "頁面：貨到付款"]), false);
  assert.equal(ok(["頁面：名牌低價"]), false);
  assert.equal(ok(["頁面：一頁式", "頁面：單頁訂購表單"]), true, "只有結構訊號照舊溫和提醒");
});

// ── 3 SEND_FAILED ──
function fake(results) { const frames = []; return { frames, send: async (f) => { frames.push(f); return results.shift() ?? { type: "error", code: "X" }; } }; }
test("3 SEND_FAILED：等 2.5 秒才補送；每次失敗回報錯誤碼", async () => {
  const waits = []; const fails = [];
  const s = fake([{ type: "error", code: "SEND_FAILED" }, { type: "sent" }]);
  const r = await sendNotice(s.send, { chatId: "c", text: "t", replyTo: "9", sleep: async (ms) => { waits.push(ms); }, onFailure: (f) => fails.push(f) });
  assert.equal(r.answer.type, "sent");
  assert.deepEqual(waits, [2500]);
  assert.deepEqual(fails.map((f) => [f.code, f.attempt, f.replied, f.replyTo]), [["SEND_FAILED", 1, true, "9"]]);
});
test("3 補送後遇逾時再退避一次", async () => {
  const waits = [];
  const s = fake([{ type: "error", code: "SEND_FAILED" }, { type: "error", code: "TIMEOUT" }, { type: "sent" }]);
  const r = await sendNotice(s.send, { chatId: "c", text: "t", replyTo: "9", sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.answer.type, "sent"); assert.deepEqual(waits, [2500, 5000]); assert.equal(s.frames.length, 3);
});
test("3 一則最多 @ 3 位", async () => {
  assert.equal(MAX_NOTICE_MENTIONS, 3);
  let text = "x\n"; const mentions = [];
  for (const n of ["甲", "乙", "丙", "丁", "戊"]) { const l = `@${n}`; mentions.push({ userId: `u${n}`, start: text.length, end: text.length + l.length }); text += `${l} `; }
  const s = fake([{ type: "sent" }]);
  await sendNotice(s.send, { chatId: "c", text, mentions });
  assert.equal(s.frames[0].mentions.length, 3);
  assert.ok(!s.frames[0].text.includes("@丁") && !s.frames[0].text.includes("@戊"));
});
test("3 同群 1 小時內 3 次失敗告警一次；日報每群次數", () => {
  let t = 0; const tr = new SendFailTracker({ now: () => t });
  assert.equal(tr.note("cA", "2026-11-05").alert, false);
  t += 1000; assert.equal(tr.note("cA", "2026-11-05").alert, false);
  t += 1000; assert.equal(tr.note("cA", "2026-11-05").alert, true);
  t += 1000; assert.equal(tr.note("cA", "2026-11-05").alert, false, "同一小時只告警一次");
  tr.note("cB", "2026-11-05");
  t += 3_700_000; assert.equal(tr.note("cA", "2026-11-05").hourCount, 1, "超過 1 小時重新計");
  assert.deepEqual(tr.dayCounts("2026-11-05"), { cA: 5, cB: 1 });
  const rows = [sendFailReportLine({ at: "2026-11-05T01:00:00Z", chatId: "cA", code: "SEND_FAILED", attempt: 1, replyExists: false }), sendFailReportLine({ at: "2026-11-05T02:00:00Z", chatId: "cA", code: "TIMEOUT", attempt: 2 }), mediaFailReportLine({ at: "2026-11-05T03:00:00Z", chatId: "cB", frame: "media:fetch", code: "MEDIA_FAILED", recovered: true })];
  assert.equal(JSON.parse(rows[0]).replyExists, false);
  const sum = summarizeOpsReport(rows, { day: "2026-11-05" });
  assert.deepEqual(sum.sendFailedByChat, { cA: 2 });
  assert.deepEqual(sum.mediaFailedByChat, { cB: { failed: 1, recovered: 1 } });
});
test("3 端對端：通知 SEND_FAILED → 日報記錯誤碼與原訊息是否還在；同群 ≥3 次寫告警", async () => {
  const r = await runGuard({}, [
    { messageId: "m1", channelId: "cWarnOnlyTest", senderId: "pBad", senderName: "陌生人", text: SWAP },
  ], { waitMs: 3500, respond: { "message:send": () => ({ type: "error", code: "SEND_FAILED" }) } });
  const fails = r.ops.filter((o) => o.kind === "send-failed");
  assert.ok(fails.length >= 2, JSON.stringify(r.ops));
  assert.ok(fails.every((o) => o.code === "SEND_FAILED" && o.chatId === "cWarnOnlyTest"));
  assert.ok(fails.some((o) => o.replyExists === false), "原訊息不在歷史裡 → replyExists=false");
});

// ── 4 短網址展開正常不加分 ──
test("4 落地正常（一般文章）→ 拿掉短網址分數；LINE／可疑網域／展開失敗照舊", () => {
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://news.example.com/a/123" }), true);
  assert.equal(shortUrlNormalLanding({ expandedUrl: undefined }), false, "展開失敗照舊");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://line.me/R/ti/p/@fakeoa123" }), false, "11/4 18:20：落地 LINE 官方帳號照舊");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://lin.ee/abcd" }), false);
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://line.me/ti/g2/FakeGroup0001" }), false, "群組邀請");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://x.example.com/addfriend?id=1" }), false, "加好友");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://x.example.com/qr/abc" }), false, "QR");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://fake-shop.top/p" }), false, "可疑 TLD");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://ok.example.com/p", landingScore: 1 }), false, "落地規則有分");
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://ok.example.com/p", lineOa: true }), false);
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://ok.example.com/p", invite: true }), false);
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://ok.example.com/p", stillShortener: true }), false);
  assert.equal(shortUrlNormalLanding({ expandedUrl: "https://ok.example.com/p", shopping: true }), false);
  assert.equal(shortUrlExpandOutcome({ expanded: null }).result, "unreachable");
});
test("4 guard：疑似短網址落地正常才改寫並 drop 短網址規則；LINE@ 先走帶單判斷", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("const susUrl = !shortUrl"), src.indexOf("const result = await decide(message, decideText, { extraNames, dropNames })"));
  assert.ok(body.indexOf("handleBandanLineOa") < body.indexOf("shortUrlNormalLanding"), "LINE@ 判斷在前");
  assert.match(body, /if \(normalLanding\) decideText = text\.replace\(susUrl\.trim\(\), expanded\.url\)/);
  assert.match(body, /const dropNames = normalLanding \? \[\.\.\.SHORT_URL_RULE_NAMES\]/);
});

// ── 5 MEDIA_FAILED 重抓 ──
test("5 抓圖失敗重抓一次；NOT_FOUND 不重抓", async () => {
  const calls = [];
  const seq = [{ type: "error", code: "MEDIA_FAILED" }, { type: "media", data: "x" }];
  const r = await fetchWithRetry(async (f) => { calls.push(f); return seq.shift(); }, { type: "media:fetch" }, { okType: "media", sleep: async () => {} });
  assert.equal(r.retried, true); assert.equal(r.answer.type, "media"); assert.equal(calls.length, 2);
  const nf = await fetchWithRetry(async () => ({ type: "error", code: "NOT_FOUND" }), { type: "media:fetch" }, { okType: "media", sleep: async () => {} });
  assert.equal(nf.retried, false);
  const line = JSON.parse(mediaFailReportLine({ chatId: "cA", messageId: "m1", frame: "media:fetch", code: "MEDIA_FAILED", retryCode: "MEDIA_FAILED", recovered: false }));
  assert.equal(line.kind, "media-failed"); assert.equal(line.recovered, false); assert.equal(line.retried, true);
});
test("5 端對端：圖片 MEDIA_FAILED → 重抓一次並寫日報", async () => {
  let n = 0;
  const r = await runGuard({ qr: { enabled: true } }, [{ messageId: "i1", channelId: "cPlainTest", senderId: "pX", senderName: "成員", contentType: "IMAGE" }], { respond: { "media:fetch": () => ({ type: "error", code: "MEDIA_FAILED", n: ++n }) } });
  const fetches = r.frames.filter((f) => f.type === "media:fetch" && f.messageId === "i1");
  assert.ok(fetches.length >= 2, `重抓：${fetches.length}`);
  assert.ok(r.ops.some((o) => o.kind === "media-failed" && o.recovered === false && o.chatId === "cPlainTest"), JSON.stringify(r.ops));
});
