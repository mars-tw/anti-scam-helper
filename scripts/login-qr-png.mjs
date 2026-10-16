// 反詐小幫手：LINE 登入輔助。流程同 `npm run cli -- login`，
// 但把 QR 存成 PNG，方便傳到手機掃描。登入完成、失敗或逾時（3 分鐘）後自動刪除 PNG 與 PIN 檔。
// 用法：node scripts/login-qr-png.mjs [--check]   --check 只確認服務狀態，不發起登入。
// 可設定（環境變數）：LINEJS_HOST（預設 127.0.0.1）、LINEJS_PORT（預設 3789）、
//   LOGIN_QR_DIR（QR PNG 與 PIN 檔放哪，預設目前目錄；兩個檔名已列入 .gitignore）。
// QR 與 PIN 等同登入憑證：只傳給自己的手機，不要貼到群組或公開的地方。
import { request } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import QRCode from "qrcode";
const PORT = Number(process.env.LINEJS_PORT ?? 3789), HOST = process.env.LINEJS_HOST ?? "127.0.0.1", HH = `${HOST}:${PORT}`;
const DIR = resolve(process.env.LOGIN_QR_DIR ?? ".");
const PNG = join(DIR, "line-login-qr.png"), PINF = join(DIR, "line-login-pin.txt");
const check = process.argv.includes("--check");
const cleanup = () => { rmSync(PNG, { force: true }); rmSync(PINF, { force: true }); };
const cookie = await new Promise((ok, no) => {
  const r = request({ host: HOST, port: PORT, path: "/", headers: { Host: HH }, timeout: 10000 }, (res) => {
    res.resume(); const c = res.headers["set-cookie"]?.[0]?.split(";")[0];
    res.statusCode === 200 && c ? ok(c) : no(new Error("服務拒絕連線"));
  });
  r.on("error", no); r.end();
});
const ws = new WebSocket(`ws://${HH}/ws`, { headers: { Host: HH, Origin: `http://${HH}`, Cookie: cookie } });
const done = (code, msg) => { if (msg) console.log(msg); cleanup(); try { ws.close(); } catch {} process.exit(code); };
setTimeout(() => done(1, "逾時（3 分鐘），QR 已作廢並刪除，請重新執行。"), 180000).unref();
let started = false;
ws.on("message", async (data) => {
  const f = JSON.parse(data.toString());
  if (f.type === "auth:state") {
    if (f.state === "restoring") return;
    if (!started) {
      console.log(`目前狀態：${f.state}`);
      if (f.state === "ready") return done(0, "已經登入，不需掃碼。");
      if (check) return done(0, "（--check：未發起登入）");
      started = true; ws.send(JSON.stringify({ type: "auth:start" })); console.log("等待 LINE 產生 QR code…");
      return;
    }
    if (f.state === "ready") return done(0, "登入成功。");
    if (f.state === "error") return done(1, "登入失敗，請重新執行。");
  }
  if (f.type === "auth:qr") { await QRCode.toFile(PNG, f.url, { width: 512, margin: 3 }); console.log(`QR 已存成 ${PNG}（請盡快傳給手機掃描）`); }
  if (f.type === "auth:pin") { writeFileSync(PINF, f.code + "\n", { mode: 0o600 }); console.log(`PIN：${f.code}（也存在 ${PINF}）`); }
  if (f.type === "auth:ready") console.log(`已登入：${f.profile?.displayName ?? ""}`);
  if (f.type === "error" && f.code === "LOGIN_UNAVAILABLE") done(1, "目前無法開始登入（已有登入程序在進行或已登入）。");
});
ws.on("error", (e) => done(1, `連線錯誤：${e.message}`));
process.on("SIGINT", () => done(130, "已中止，QR 已刪除。"));
