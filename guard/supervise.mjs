// 看門狗：讓守衛（以及選用的 LINE.js 服務）一直跑著。任何一個結束或當掉，等一下就自動重啟。
// 用法：
//   node guard/supervise.mjs                只看顧守衛（LINE.js 由別處啟動，例如 linejs.ps1 start）
//   node guard/supervise.mjs --with-server  連 LINE.js 服務一起看顧
// 其餘參數原樣交給 guard.mjs（例如設定檔路徑）。
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const args = process.argv.slice(2);
const withServer = args.includes("--with-server");
const guardArgs = args.filter((arg) => arg !== "--with-server");

const children = [];
let stopping = false;

function keep(name, command, commandArgs, cwd, startDelayMs = 0) {
  let backoff = 5000;
  let child;
  const start = () => {
    if (stopping) return;
    const startedAt = Date.now();
    console.log(`[看門狗] 啟動 ${name}`);
    child = spawn(command, commandArgs, { cwd, stdio: "inherit" });
    children.push(child);
    child.on("exit", (code, signal) => {
      children.splice(children.indexOf(child), 1);
      if (stopping) return;
      // 穩定跑超過 10 分鐘才算恢復正常，重新從短等待開始。
      if (Date.now() - startedAt > 10 * 60_000) backoff = 5000;
      console.error(`[看門狗] ${name} 結束（${signal ?? `代碼 ${code}`}），${backoff / 1000} 秒後重啟`);
      setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, 5 * 60_000);
    });
  };
  setTimeout(start, startDelayMs);
}

if (withServer) keep("LINE.js 服務", process.execPath, [join(repo, "dist", "main.js")], repo);
// 有一起啟動服務時，讓守衛晚幾秒再連，免得第一次連線就失敗。
keep("反詐守衛", process.execPath, [join(here, "guard.mjs"), ...guardArgs], repo, withServer ? 5000 : 0);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    for (const child of children) child.kill(signal);
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
