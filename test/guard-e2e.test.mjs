// 端對端：真的啟動 guard.mjs，接假的 LINE.js WebSocket 伺服器與假的模型（永遠回 SCAM，最壞情況），
// 檢查受保護成員、冒名、kickMode=notify 不會送出踢人請求。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocketServer } from "../guard/node_modules/ws/wrapper.mjs";

const SCAM_TEXT = "通知：本群明天要刪除了，請大家加入新群 https://scam-site.xyz/join 快點";
const NORMAL_TEXT = "我剛剛醒，睡很久";
const now = Date.now();

async function runGuard(extraConfig, live, { history = [], waitMs = 2500 } = {}) {
  const llm = createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "SCAM\n測試" } }] })); }); });
  await new Promise((done) => llm.listen(0, "127.0.0.1", done));
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((done) => wss.on("listening", done));
  const frames = [];
  let seq = 0;
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "auth:ready", profile: { userId: "uMe", displayName: "bot" } }));
    socket.send(JSON.stringify({ type: "channels", channels: [{ channelId: "cA", name: "社群甲", kind: "square" }, { channelId: "cB", name: "社群乙", kind: "square" }] }));
    socket.on("message", (data) => {
      const f = JSON.parse(data.toString());
      frames.push(f);
      if (f.type === "history:fetch") socket.send(JSON.stringify({ type: "history", requestId: f.requestId, chatId: f.chatId, messages: history.filter((m) => m.channelId === f.chatId), hasMore: false }));
      else if (f.type === "message:send") socket.send(JSON.stringify({ type: "sent", requestId: f.requestId, messageId: `sent${++seq}` }));
      else if (f.type === "member:remove") socket.send(JSON.stringify({ type: "member:removed", requestId: f.requestId, chatId: f.chatId, messageId: f.messageId, memberId: "x", messageDeleted: true }));
      else if (f.type === "message:delete") socket.send(JSON.stringify({ type: "message:deleted", requestId: f.requestId }));
    });
    setTimeout(() => { for (const m of live) socket.send(JSON.stringify({ type: "message", message: { contentType: "NONE", channelKind: "square", createdAt: Date.now(), ...m } })); }, 600);
  });
  const dir = mkdtempSync(join(tmpdir(), "guard-e2e-"));
  const model = { backend: "openai", baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: "fake", apiKeyEnv: "" };
  const config = {
    dryRun: false, localScreenAll: true, kickPolicy: "strict", strongScore: 6, reviewScore: 3, notifyScore: 3, deleteMessage: true,
    llm: model, review: model, patterns: { enabled: false }, qr: { enabled: false }, logDir: join(dir, "logs"),
    notify: { enabled: true, chats: ["cA", "cB"], cooldownSeconds: 0, beforeActionMs: 10 }, scamLink: { deleteOnConfirmed: true },
    catchUp: { scanMinutes: 0 }, ...extraConfig,
  };
  writeFileSync(join(dir, "guard.config.json"), JSON.stringify(config));
  const child = spawn(process.execPath, ["guard/guard.mjs", join(dir, "guard.config.json")], { env: { ...process.env, LINEJS_TOKEN: "test", LINEJS_URL: `ws://127.0.0.1:${wss.address().port}` }, stdio: "ignore" });
  await new Promise((done) => setTimeout(done, waitMs));
  child.kill();
  wss.close(); llm.close();
  rmSync(dir, { recursive: true, force: true });
  return { removes: frames.filter((f) => f.type === "member:remove"), deletes: frames.filter((f) => f.type === "message:delete"), sends: frames.filter((f) => f.type === "message:send") };
}

test("對照：一般成員貼高分詐騙＋兩模型 SCAM → 會送踢人（確認測試抓得到）", async () => {
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cA", senderId: "pBad", senderName: "陌生人", text: SCAM_TEXT }]);
  assert.equal(r.removes.length, 1);
});

test("受保護成員（protectedIds）：就算模型都判 SCAM 也不踢、不刪、不通知", async () => {
  const r = await runGuard({ protectedIds: [{ note: "別社群的機器人", ids: ["pProt"] }] }, [
    { messageId: "m1", channelId: "cA", senderId: "pProt", senderName: "阿明", text: SCAM_TEXT },
    { messageId: "m2", channelId: "cB", senderId: "pProt", senderName: "阿明", text: "看這個 https://scam-site.xyz/a" },
  ]);
  assert.equal(r.removes.length, 0);
  assert.equal(r.deletes.length, 0);
  assert.equal(r.sends.length, 0);
});

test("冒名：同社群同名不同 ID、Meta 判 SCAM → 預設只通知，不踢", async () => {
  const history = [{ messageId: "h1", channelId: "cA", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "大家好", createdAt: now - 60_000 }];
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cA", senderId: "pOther", senderName: "阿明", text: NORMAL_TEXT }], { history });
  assert.equal(r.removes.length, 0);
  assert.equal(r.deletes.length, 0);
  assert.equal(r.sends.length, 1);
});

test("冒名：管理員在別的社群，不比對、不通知", async () => {
  const history = [{ messageId: "h1", channelId: "cA", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "大家好", createdAt: now - 60_000 }];
  const r = await runGuard({}, [{ messageId: "m1", channelId: "cB", senderId: "pOther", senderName: "阿明", text: NORMAL_TEXT }], { history });
  assert.equal(r.removes.length + r.deletes.length + r.sends.length, 0);
});

test("kickMode=notify：達踢人門檻也只通知，不踢", async () => {
  const r = await runGuard({ kickMode: "notify" }, [{ messageId: "m1", channelId: "cA", senderId: "pBad", senderName: "陌生人", text: SCAM_TEXT }]);
  assert.equal(r.removes.length, 0);
  assert.equal(r.sends.length, 1);
});

test("對照：impersonation.kick=true 才會因冒名踢人（舊行為，預設關閉）", async () => {
  const history = [{ messageId: "h1", channelId: "cA", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "大家好", createdAt: now - 60_000 }];
  const r = await runGuard({ impersonation: { kick: true } }, [{ messageId: "m1", channelId: "cA", senderId: "pOther", senderName: "阿明", text: NORMAL_TEXT }], { history });
  assert.equal(r.removes.length, 1);
});
