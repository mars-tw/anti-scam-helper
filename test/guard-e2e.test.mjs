// 端對端：真的啟動 guard.mjs，接假的 LINE.js WebSocket 伺服器與假的模型（永遠回 SCAM，最壞情況），
// 檢查受保護成員、冒名、kickMode=notify 不會送出踢人請求。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import QRCode from "qrcode";
import { WebSocketServer } from "../guard/node_modules/ws/wrapper.mjs";

const SCAM_TEXT = "通知：本群明天要刪除了，請大家加入新群 https://scam-site.xyz/join 快點";
const NORMAL_TEXT = "我剛剛醒，睡很久";
const now = Date.now();

async function runGuard(extraConfig, live, { history = [], waitMs = 2500, chatAnswer, media } = {}) {
  const llm = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      // 小助手的提示裡有「回答範圍」；其餘（詐騙判斷、覆核）一律回 SCAM。
      const content = chatAnswer && body.includes("回答範圍") ? (typeof chatAnswer === "function" ? chatAnswer(JSON.parse(body)) : chatAnswer) : "SCAM\n測試";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
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
      else if (f.type === "media:fetch") socket.send(JSON.stringify(media ? { type: "media", requestId: f.requestId, mime: "image/png", data: media } : { type: "error", requestId: f.requestId, code: "NOT_FOUND" }));
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
  return { frames, removes: frames.filter((f) => f.type === "member:remove"), deletes: frames.filter((f) => f.type === "message:delete"), sends: frames.filter((f) => f.type === "message:send") };
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

// 小助手：問到踢人、刪除、管理員權限等，只回固定句，不讓模型說明。
const CHAT = { chat: { enabled: true, triggers: ["小助手"], onMention: false, userCooldownSeconds: 0 } };
const OK_ANSWER = "這個問題很好，記得查證喔";

// 假模型：把系統提示裡的「守衛現況」原樣回出來，檢查小助手拿到的事實。
const echoFacts = (req) => {
  const prompt = JSON.stringify(req);
  return [
    prompt.includes("踢人功能目前暫停") ? "踢人功能目前暫停，只通知管理員。" : prompt.includes("可能會把對方移出") ? "確認是詐騙的帳號可能會被移出社群。" : "",
    prompt.includes("本帳號在這個群是管理員") ? "本帳號在這個群是管理員。" : prompt.includes("不是管理員") ? "在這個群只能通知管理員處理。" : "",
  ].filter(Boolean).join("");
};

test("小助手：問踢人 → 依目前設定回答（kickMode=notify：暫停、只通知）", async () => {
  const r = await runGuard({ ...CHAT, kickMode: "notify", protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 你把阿明剔除去了？" }], { chatAnswer: echoFacts });
  assert.equal(r.sends.length, 1);
  assert.ok(r.sends[0].text.includes("踢人功能目前暫停"), r.sends[0].text);
  assert.ok(r.sends[0].text.includes("本帳號在這個群是管理員"), r.sends[0].text);
});

test("小助手：kickMode=kick 時說可能移出；非管理員的群說只能通知", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"], questionRedact: { noDeleteChats: ["cB"] } }, [{ messageId: "q1", channelId: "cB", senderId: "pAsk", senderName: "成員", text: "小助手 你有管理員權限嗎" }], { chatAnswer: echoFacts });
  assert.equal(r.sends.length, 1);
  assert.ok(r.sends[0].text.includes("可能會被移出"), r.sends[0].text);
  assert.ok(r.sends[0].text.includes("只能通知管理員"), r.sends[0].text);
});

test("小助手：「怎麼刪 git branch」照常回答", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 怎麼刪 git branch" }], { chatAnswer: "用 git branch -d 分支名稱 就可以" });
  assert.equal(r.sends.length, 1);
  assert.ok(r.sends[0].text.startsWith("用 git branch -d"));
});

test("小助手：管理員群卻說「沒有權限」→ 換成固定句", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 你有權限嗎" }], { chatAnswer: "我沒有管理員權限啦" });
  assert.deepEqual(r.sends.map((f) => f.text), ["這要等本人回覆"]);
});

test("小助手：請求邀回某人 → 「這個我會轉給本人處理」不被承諾過濾擋", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 可以把阿明邀回來嗎" }], { chatAnswer: "這個我會轉給本人處理。" });
  assert.deepEqual(r.sends.map((f) => f.text), ["這個我會轉給本人處理"]);
});

test("小助手：模型自己說「我沒有踢人」→ 輸出過濾換成固定句", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 剛剛發生什麼事" }], { chatAnswer: "沒有啊，我這邊沒有踢人，也沒有管理員權限。" });
  assert.deepEqual(r.sends.map((f) => f.text), ["這要等本人回覆"]);
});

test("小助手：一般問題照常回答", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 今天天氣如何" }], { chatAnswer: OK_ANSWER });
  assert.equal(r.sends.length, 1);
  assert.ok(r.sends[0].text.startsWith(OK_ANSWER));
});

test("小助手：模型替本人承諾（我再把規則調鬆）→ 固定句", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 剛剛怎麼了" }], { chatAnswer: "我再把規則調鬆一點，辛苦你重新進來了" });
  assert.deepEqual(r.sends.map((f) => f.text), ["這要等本人回覆"]);
});

test("小助手：一般建議照常回答", async () => {
  const r = await runGuard({ ...CHAT, protectedIds: ["pAsk"] }, [{ messageId: "q1", channelId: "cA", senderId: "pAsk", senderName: "成員", text: "小助手 這個連結安全嗎" }], { chatAnswer: "你可以先查證來源，不要匯款給陌生人" });
  assert.equal(r.sends.length, 1);
  assert.ok(r.sends[0].text.startsWith("你可以先查證來源"));
});

// 冒名＋邀請／QR：冒用（任一社群的）管理員暱稱，又貼外部邀請連結或 QR。
const ADMIN_HISTORY = [{ messageId: "h1", channelId: "cA", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", channelKind: "square", contentType: "NONE", text: "大家好", createdAt: now - 60_000 }];
const INVITE = "新群在這 https://line.me/ti/g2/ExtGroup999";

test("冒名＋群組邀請連結（別的社群的管理員名）：通知＋刪除，開關關閉不踢", async () => {
  const r = await runGuard({ kickMode: "notify", impersonation: { kickWithInvite: false } }, [{ messageId: "m1", channelId: "cB", senderId: "pImp", senderName: "阿明", text: INVITE }], { history: ADMIN_HISTORY });
  assert.equal(r.removes.length, 0);
  assert.deepEqual(r.deletes.map((f) => f.messageId), ["m1"]);
  assert.ok(r.sends.length >= 1);
  assert.equal(r.sends[0].replyTo, "m1");
});

test("冒名＋群組邀請連結：kickWithInvite=true 時踢人（即使 kickMode=notify）", async () => {
  const r = await runGuard({ kickMode: "notify", impersonation: { kickWithInvite: true } }, [{ messageId: "m1", channelId: "cB", senderId: "pImp", senderName: "阿明", text: INVITE }], { history: ADMIN_HISTORY });
  assert.equal(r.removes.length, 1);
  assert.equal(r.removes[0].messageId, "m1");
  assert.ok(r.sends.length >= 1);
});

test("冒名：前一則閒聊、2 分鐘內再貼連結 → 兩則都刪", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: false } }, [
    { messageId: "m1", channelId: "cB", senderId: "pImp", senderName: "阿明", text: "大家好我是管理員" },
    { messageId: "m2", channelId: "cB", senderId: "pImp", senderName: "阿明", text: INVITE },
  ], { history: ADMIN_HISTORY });
  assert.deepEqual(r.deletes.map((f) => f.messageId).sort(), ["m1", "m2"]);
  assert.equal(r.removes.length, 0);
});

test("冒名＋外部 LINE QR 圖片：通知＋刪除", async () => {
  const png = (await QRCode.toBuffer("https://line.me/ti/g2/ExtGroup999", { width: 300 })).toString("base64");
  const r = await runGuard({ qr: { enabled: true }, impersonation: { kickWithInvite: false } }, [{ messageId: "m1", channelId: "cB", senderId: "pImp", senderName: "阿明", contentType: "IMAGE" }], { history: ADMIN_HISTORY, media: png });
  assert.deepEqual(r.deletes.map((f) => f.messageId), ["m1"]);
  assert.equal(r.removes.length, 0);
});

test("冒名但沒有連結：只通知（同社群），不刪不踢", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: true } }, [{ messageId: "m1", channelId: "cA", senderId: "pImp", senderName: "阿明", text: "大家好" }], { history: ADMIN_HISTORY });
  assert.equal(r.removes.length + r.deletes.length, 0);
  assert.equal(r.sends.length, 1);
});

test("受保護成員（真本人另一個 ID）貼連結：不處置", async () => {
  const r = await runGuard({ protectedIds: [{ note: "本人", ids: ["pReal"] }], impersonation: { kickWithInvite: true } }, [{ messageId: "m1", channelId: "cB", senderId: "pReal", senderName: "阿明", text: INVITE }], { history: ADMIN_HISTORY });
  assert.equal(r.removes.length + r.deletes.length + r.sends.length, 0);
});

test("真管理員貼 QR：不處置", async () => {
  const png = (await QRCode.toBuffer("https://line.me/ti/g2/ExtGroup999", { width: 300 })).toString("base64");
  const r = await runGuard({ qr: { enabled: true }, impersonation: { kickWithInvite: true } }, [{ messageId: "m1", channelId: "cA", senderId: "pAdmin", senderName: "阿明", senderRole: "coAdmin", contentType: "IMAGE" }], { history: ADMIN_HISTORY, media: png });
  assert.equal(r.removes.length + r.deletes.length + r.sends.length, 0);
});

test("非管理員的群：冒名＋連結只通知（請管理員處理）", async () => {
  const r = await runGuard({ impersonation: { kickWithInvite: true }, questionRedact: { noDeleteChats: ["cB"] } }, [{ messageId: "m1", channelId: "cB", senderId: "pImp", senderName: "阿明", text: INVITE }], { history: ADMIN_HISTORY });
  assert.equal(r.removes.length + r.deletes.length, 0);
  assert.equal(r.sends.length, 1);
});
