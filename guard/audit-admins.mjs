// 稽核：經機器人 API（唯讀 history:fetch）往回翻各守護聊天室的訊息，找出帶管理身分的發言者。
// 社群（square）角色：admin＝群主（建立者），coAdmin＝共同管理員。一般群組沒有角色資訊。
// 只看得到「最近有發言」的管理員；沒發言過的管理員本工具找不到。
// 用法：LINEJS_TOKEN=... node guard/audit-admins.mjs [每個聊天室最多頁數，預設 10] > 稽核.json
import WebSocket from "ws";

const token = process.env.LINEJS_TOKEN;
if (!token) { console.error("缺少 LINEJS_TOKEN"); process.exit(1); }
const maxPages = Number(process.argv[2] ?? 10);
const ws = new WebSocket(process.env.LINEJS_URL ?? "ws://127.0.0.1:3789/api/ws", { headers: { Authorization: `Bearer ${token}` } });
const waiting = new Map();
let seq = 0;
let channels;
let me;
ws.on("message", (data) => {
  const frame = JSON.parse(data.toString());
  if (frame.requestId && waiting.has(frame.requestId)) { waiting.get(frame.requestId)(frame); waiting.delete(frame.requestId); return; }
  if (frame.type === "channels") channels = frame.channels;
  if (frame.type === "auth:ready") me = frame.profile;
});
const call = (frame) => new Promise((done) => {
  const requestId = `audit${++seq}`;
  const timer = setTimeout(() => { waiting.delete(requestId); done({ type: "error", code: "TIMEOUT" }); }, 30_000);
  waiting.set(requestId, (reply) => { clearTimeout(timer); done(reply); });
  ws.send(JSON.stringify({ ...frame, requestId }));
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
await new Promise((done, fail) => { ws.once("open", done); ws.once("unexpected-response", (_, r) => fail(new Error(`HTTP ${r.statusCode}`))); });
for (let i = 0; i < 50 && !channels; i++) await sleep(100);

const report = { at: new Date().toISOString(), account: me?.displayName, chats: [] };
for (const channel of channels ?? []) {
  const managers = new Map();
  let before, scanned = 0, pages = 0, error, oldest;
  while (pages < maxPages) {
    let page;
    for (let attempt = 0; attempt < 3; attempt++) {
      page = await call({ type: "history:fetch", chatId: channel.channelId, limit: 100, ...(before ? { before } : {}) });
      if (page.type === "history") break;
      await sleep(2000);
    }
    if (page.type !== "history") { error = page.code; break; }
    pages++;
    for (const message of page.messages) {
      scanned++;
      oldest = Math.min(oldest ?? Infinity, message.createdAt ?? Infinity);
      if (!message.senderRole) continue;
      const known = managers.get(message.senderId);
      managers.set(message.senderId, { id: message.senderId, name: message.senderName, role: message.senderRole, lastSeen: Math.max(known?.lastSeen ?? 0, message.createdAt ?? 0), messages: (known?.messages ?? 0) + 1 });
    }
    if (!page.hasMore || !page.cursor) break;
    before = page.cursor;
    await sleep(1200);
  }
  report.chats.push({
    chatId: channel.channelId, name: channel.name, kind: channel.kind, memberCount: channel.memberCount,
    scannedMessages: scanned, pages, ...(oldest && oldest !== Infinity ? { oldestScanned: new Date(oldest).toISOString() } : {}), ...(error ? { error } : {}),
    owner: [...managers.values()].filter((m) => m.role === "admin").map((m) => ({ ...m, lastSeen: new Date(m.lastSeen).toISOString() })),
    coAdmins: [...managers.values()].filter((m) => m.role === "coAdmin").map((m) => ({ ...m, lastSeen: new Date(m.lastSeen).toISOString() })),
  });
  console.error(`${channel.name}：掃 ${scanned} 則，群主 ${report.chats.at(-1).owner.length}、共同管理員 ${report.chats.at(-1).coAdmins.length}${error ? `（錯誤 ${error}）` : ""}`);
}
ws.close();
console.log(JSON.stringify(report, null, 2));
