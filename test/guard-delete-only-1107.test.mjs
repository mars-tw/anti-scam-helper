// 士軒 11/7：外部邀請 QR 與假搬家公告各自刪文，不影響既有踢人流程。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import QRCode from "qrcode";
import { WebSocketServer } from "../guard/node_modules/ws/wrapper.mjs";
import { outboundGate, STRONG_FAKE_MOVE_IMAGE } from "../guard/strong-gate.mjs";

// 士軒 11/7：產生真正可解碼、沒有 QR 的純色 PNG。
function solidPng() {
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(64 * (1 + 64 * 3), 255);
  for (let y = 0; y < 64; y++) rows[y * (1 + 64 * 3)] = 0;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

async function runGuard(extraConfig, live, { history = [], waitMs = 4000, visionAnswer, media, setup, channels, invites = {} } = {}) {
  let visionCalls = 0;
  const llm = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const image = body.includes("image_url");
      if (image) visionCalls++;
      const content = image && visionAnswer ? visionAnswer : "SCAM\n測試";
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
    socket.send(JSON.stringify({ type: "channels", channels: channels ?? [{ channelId: "cA", name: "社群甲", kind: "square" }, { channelId: "cB", name: "社群乙", kind: "square" }] }));
    socket.on("message", (data) => {
      const f = JSON.parse(data.toString());
      frames.push(f);
      if (f.type === "history:fetch") socket.send(JSON.stringify({ type: "history", requestId: f.requestId, chatId: f.chatId, messages: history.filter((m) => m.channelId === f.chatId), hasMore: false }));
      else if (f.type === "message:send") socket.send(JSON.stringify({ type: "sent", requestId: f.requestId, messageId: `sent${++seq}` }));
      else if (f.type === "member:remove") socket.send(JSON.stringify({ type: "member:removed", requestId: f.requestId, chatId: f.chatId, messageId: f.messageId, memberId: "x", messageDeleted: true }));
      else if (f.type === "media:fetch") socket.send(JSON.stringify(media ? { type: "media", requestId: f.requestId, mime: "image/png", data: media } : { type: "error", requestId: f.requestId, code: "NOT_FOUND" }));
      else if (f.type === "message:delete") socket.send(JSON.stringify({ type: "message:deleted", requestId: f.requestId }));
      else if (f.type === "invite:own") socket.send(JSON.stringify({ type: "invite:own", requestId: f.requestId, chatId: f.chatId, squareMid: `s-${f.chatId}`, links: invites.own ?? [] }));
      else if (f.type === "invite:lookup") socket.send(JSON.stringify(invites.lookup?.[f.ticket] ? { type: "invite:lookup", requestId: f.requestId, chatId: f.chatId, found: true, squareMid: invites.lookup[f.ticket] } : { type: "invite:lookup", requestId: f.requestId, chatId: f.chatId, found: false }));
    });
    setTimeout(() => { for (const m of live) socket.send(JSON.stringify({ type: "message", message: { contentType: "NONE", channelKind: "square", createdAt: Date.now(), ...m } })); }, 600);
  });
  const dir = mkdtempSync(join(tmpdir(), "guard-delete-only-"));
  const model = { backend: "openai", baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: "fake", apiKeyEnv: "" };
  const config = {
    dryRun: false, localScreenAll: true, kickPolicy: "strict", strongScore: 6, reviewScore: 3, notifyScore: 3, deleteMessage: true,
    llm: model, review: model, patterns: { enabled: false }, qr: { enabled: false }, logDir: join(dir, "logs"),
    notify: { enabled: true, chats: ["cA", "cB"], cooldownSeconds: 0, beforeActionMs: 10 }, scamLink: { deleteOnConfirmed: true },
    catchUp: { scanMinutes: 0 }, knowledge: { enabled: false, prefetch: false }, ...extraConfig,
  };
  if (setup) setup(dir, config);
  writeFileSync(join(dir, "guard.config.json"), JSON.stringify(config));
  const child = spawn(process.execPath, ["guard/guard.mjs", join(dir, "guard.config.json")], { env: { ...process.env, LINEJS_TOKEN: "test", GUARD_NO_KICK_FILE: join(dir, "no-GUARD_NO_KICK"), GUARD_NO_KICK_CHATS_FILE: join(dir, "no-GUARD_NO_KICK_CHATS"), LINEJS_URL: `ws://127.0.0.1:${wss.address().port}` }, stdio: "ignore" });
  await new Promise((done) => setTimeout(done, waitMs));
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done));
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))]);
  wss.close(); llm.close();
  rmSync(dir, { recursive: true, force: true });
  return { frames, visionCalls, removes: frames.filter((f) => f.type === "member:remove"), deletes: frames.filter((f) => f.type === "message:delete"), sends: frames.filter((f) => f.type === "message:send") };
}

const image = (overrides = {}) => ({ messageId: "m1", channelId: "cA", senderId: "pBad", senderName: "陌生人", contentType: "IMAGE", ...overrides });
const invite = "https://line.me/ti/g2/FakeGroup0001";
const fakeMove = "SCAM\n本群混入詐騙，已建立新群重新審核，公告請原成員轉移到新群";
const setupVision = (dir, c) => { c.vision = { enabled: true, action: "report", ...c.vision, llm: c.llm }; };
const qrPng = async (url = invite) => (await QRCode.toBuffer(url, { width: 300 })).toString("base64");
const qrConfig = { kickMode: "notify", qr: { enabled: true, kickOnConfirmed: false } };
const qrOptions = async () => ({ media: await qrPng(), invites: { lookup: { FakeGroup0001: "s-elsewhere" } } });
const visionOptions = (answer = fakeMove) => ({ media: solidPng(), visionAnswer: answer, setup: setupVision });
function noActions(r) { assert.equal(r.deletes.length, 0); assert.equal(r.removes.length, 0); }
function deletedOnly(r, id = "m1") { assert.deepEqual(r.deletes.map((f) => f.messageId), [id]); assert.equal(r.removes.length, 0); }

test("強特徵閘：假搬家圖片通過，普通公告不通過", () => {
  assert.equal(outboundGate({ names: [STRONG_FAKE_MOVE_IMAGE], verdict: "VISION_SCAM_WEAK" }).send, true);
  assert.equal(outboundGate({ names: ["官方公告畫面"] }).send, false);
  assert.equal(outboundGate({ names: ["圖片假群組公告"] }).send, false);
});

test("別的社群 QR：只刪文；確認踢人設定保留；自家 QR 放行", async () => {
  const opts = await qrOptions();
  const r = await runGuard(qrConfig, [image()], opts);
  deletedOnly(r);
  assert.ok(r.frames.some((f) => f.type === "invite:lookup" && f.ticket === "FakeGroup0001"));
  const kick = await runGuard({ kickMode: "kick", qr: { enabled: true, kickOnConfirmed: true } }, [image()], opts);
  assert.equal(kick.removes.length, 1);
  assert.equal(kick.removes[0].deleteMessage, true);
  const own = await runGuard(qrConfig, [image()], { ...opts, invites: { own: [invite] } });
  noActions(own);
});

test("假搬家公告圖：SCAM_WEAK 仍刪文且通知不被總閘擋住", async () => {
  const r = await runGuard({ kickMode: "notify", qr: { enabled: true } }, [image()], visionOptions());
  assert.ok(r.visionCalls > 0);
  deletedOnly(r);
  assert.ok(r.sends.length > 0);
});

test("一般公告、防詐提醒與對抗圖不刪；確認看圖模型有執行", async () => {
  for (const answer of ["SCAM\n官方公告畫面，模型用量上限", "OK\n防詐騙提醒：不要點陌生連結", "SCAM\n防詐宣導公告，提醒小心詐騙", "SCAM\n交易所官方公告：追蹤跟單活動", "SCAM\n商家促銷特價折扣海報"]) {
    const r = await runGuard({ kickMode: "notify", qr: { enabled: true } }, [image()], visionOptions(answer));
    assert.ok(r.visionCalls > 0, answer);
    noActions(r);
  }
  const text = await runGuard({ kickMode: "kick" }, [{ messageId: "t1", channelId: "cA", senderId: "pText", senderName: "成員", text: "幣安官方帳號跟單交易教學 歡迎追蹤" }]);
  noActions(text);
});

test("排除、只學習、只警告、白名單及管理員：兩類皆不刪不踢", async () => {
  const cases = [
    [{ kickScope: { excludeChats: ["cA"] } }, image()],
    [{ groupPolicies: { cA: { learnOnly: true } } }, image()],
    [{ groupPolicies: { cA: { warnOnly: true } } }, image()],
    [{ whitelist: ["pBad"] }, image()],
    [{}, image({ senderRole: "coAdmin" })],
  ];
  const opts = await qrOptions();
  for (const [extra, message] of cases) {
    noActions(await runGuard({ ...qrConfig, ...extra }, [message], opts));
    noActions(await runGuard({ kickMode: "notify", qr: { enabled: true }, ...extra }, [message], visionOptions()));
  }
});

test("Hao 類通知群：兩類各自刪文不踢", async () => {
  const policy = { cA: { kickMode: "notify" } };
  deletedOnly(await runGuard({ ...qrConfig, groupPolicies: policy }, [image()], await qrOptions()));
  deletedOnly(await runGuard({ kickMode: "notify", qr: { enabled: true }, groupPolicies: policy }, [image()], visionOptions()));
});

test("停用刪文及試跑：兩類都不送刪除或踢人", async () => {
  const opts = await qrOptions();
  for (const extra of [{ deleteMessage: false }, { dryRun: true }]) {
    noActions(await runGuard({ ...qrConfig, ...extra }, [image()], opts));
    noActions(await runGuard({ kickMode: "notify", qr: { enabled: true }, ...extra }, [image()], visionOptions()));
  }
});

test("已知詐騙邀請碼仍踢；換群文字既有踢人路徑不變", async () => {
  const known = await runGuard({ kickMode: "kick", qr: { enabled: true, kickOnConfirmed: false }, scamInviteTickets: ["KnownBad0001"] }, [image()], { media: await qrPng("https://line.me/ti/g2/KnownBad0001") });
  assert.equal(known.removes.length, 1);
  assert.equal(known.removes[0].deleteMessage, true);
  const text = await runGuard({ kickMode: "kick" }, [{ messageId: "t1", channelId: "cA", senderId: "pBad", senderName: "陌生人", text: `通知：本群明天要刪除了，請大家加入新群 ${invite} 快點` }]);
  assert.equal(text.removes.length, 1);
});

test("同時守護不同群：排除群不動，其他群仍刪", async () => {
  const messages = [image({ messageId: "a1" }), image({ messageId: "b1", channelId: "cB", senderId: "pOther" })];
  const opts = await qrOptions();
  const qr = await runGuard({ ...qrConfig, kickScope: { excludeChats: ["cB"] } }, messages, opts);
  deletedOnly(qr, "a1");
  const vision = await runGuard({ kickMode: "notify", qr: { enabled: true }, kickScope: { excludeChats: ["cB"] } }, messages, visionOptions());
  deletedOnly(vision, "a1");
});
