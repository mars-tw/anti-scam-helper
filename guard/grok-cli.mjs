// 用主機上已登入的 Grok CLI（本人自己的 grok.com 訂閱）當備援模型：headless 單次（grok -p），
// 空的工作目錄＋沙箱設定檔（只讀系統路徑與 ~/.grok，讀不到專案、設定與 env），關掉所有工具、網路搜尋與子代理。
// 不讀、不碰 CLI 的登入檔；登入由 CLI 自己更新。環境變數只給 HOME 與 PATH（不把任何金鑰傳給它）。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const GROK_CLI_DEFAULTS = {
  bin: join(homedir(), ".grok", "bin", "grok"),
  workDir: "/tmp/grok-guard",
  sandbox: "guard",
  model: "grok-4.7-build-fast",
  imageModel: "grok-4.7",
  timeoutMs: 60_000,
  concurrency: 2,
  effort: "low",
  maxImageBase64: 100_000,
  disableMinutesOnAuthError: 30,
};

const NO_TOOLS = "run_terminal_cmd,read_file,grep,list_dir,write,search_replace,web_search,web_fetch,task,Agent,image_gen,Shell,Delete,StrReplace,EditNotebook,GenerateImage,GenerateVideo,XSearch,CallMcpTool";
export const VERDICT_SCHEMA = { type: "object", properties: { verdict: { type: "string", enum: ["SCAM", "UNSURE", "OK"] }, reason: { type: "string" } }, required: ["verdict", "reason"] };

let running = 0;
const queue = [];
const state = { disabledUntil: 0, logged: false };
export function grokCliState() { return { ...state, running, queued: queue.length }; }
export function resetGrokCliState() { state.disabledUntil = 0; state.logged = false; }

async function slot(limit) {
  if (running < limit) { running++; return; }
  await new Promise((resolve) => queue.push(resolve));
  running++;
}
function release() { running--; queue.shift()?.(); }

/** 組 grok 的參數（給測試看）。 */
export function grokArgs(cfg, { promptFile, promptJson, system, model, schema }) {
  const args = [];
  if (promptJson) args.push("--prompt-json", promptJson); else args.push("--prompt-file", promptFile);
  args.push("--cwd", cfg.workDir, "--sandbox", cfg.sandbox, "-m", model, "--output-format", "json",
    "--disallowed-tools", NO_TOOLS, "--disable-web-search", "--no-subagents", "--max-turns", "1", "--no-auto-update");
  if (cfg.effort) args.push("--effort", cfg.effort);
  if (system) args.push("--system-prompt-override", system);
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  return args;
}

/**
 * 呼叫一次；成功回 { text, usage, structured }，失敗丟錯（錯誤碼不含內容）。
 * image：{ mime, base64 }（太大就不送圖，丟 IMAGE_TOO_LARGE）。
 */
export async function grokCli(llm, system, user, { image, schema, spawnImpl = spawn, now = Date.now, onAuthError = () => {} } = {}) {
  const cfg = { ...GROK_CLI_DEFAULTS, ...llm };
  if (now() < state.disabledUntil) throw new Error("GROK_DISABLED");
  if (image && image.base64.length > cfg.maxImageBase64) throw new Error("IMAGE_TOO_LARGE");
  mkdirSync(cfg.workDir, { recursive: true, mode: 0o700 });
  try { chmodSync(cfg.workDir, 0o700); } catch {}
  const id = randomUUID();
  const promptFile = join(cfg.workDir, `req-${id}.txt`);
  const model = image ? cfg.imageModel : cfg.model;
  let promptJson;
  if (image) promptJson = JSON.stringify([{ type: "image", mimeType: image.mime, data: image.base64 }, { type: "text", text: user }]);
  else writeFileSync(promptFile, user, { mode: 0o600 });
  await slot(cfg.concurrency);
  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawnImpl(cfg.bin, grokArgs(cfg, { promptFile, promptJson, system, model, schema }), {
        cwd: cfg.workDir, env: { HOME: homedir(), PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { if (stdout.length < 2_000_000) stdout += d; });
      child.stderr.on("data", (d) => { if (stderr.length < 20_000) stderr += d; });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("TIMEOUT")); }, cfg.timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); reject(new Error(error.code === "ENOENT" ? "NO_CLI" : "SPAWN")); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    if (out.code !== 0 || !out.stdout.trim()) {
      if (/log\s*in|login|auth|unauthori[sz]ed|401|403|token|expired|sign in/i.test(out.stderr)) {
        state.disabledUntil = now() + cfg.disableMinutesOnAuthError * 60_000;
        if (!state.logged) { state.logged = true; onAuthError(); }
        throw new Error("AUTH");
      }
      throw new Error(`EXIT_${out.code}`);
    }
    let data;
    try { data = JSON.parse(out.stdout); } catch { throw new Error("BAD_JSON"); }
    state.logged = false;
    const text = typeof data.text === "string" ? data.text.trim() : "";
    let structured = data.structuredOutput;
    if (schema && !structured) { try { structured = JSON.parse(text); } catch {} }
    if (!text && !structured) throw new Error("EMPTY");
    const usage = { input: Number(data.usage?.input_tokens) || 0, output: Number(data.usage?.output_tokens) || 0, costUsd: Number(data.total_cost_usd) || 0 };
    return { text, usage, structured };
  } finally {
    release();
    try { rmSync(promptFile, { force: true }); } catch {}
  }
}

/** 給 llm.mjs：判定題用 JSON schema，回成「SCAM 理由」這種第一個字是判定的文字；一般題回文字。 */
export async function grokCliText(llm, system, user, maxTokens, image, options = {}) {
  const verdict = llm.verdict === true;
  const result = await grokCli(llm, system, user, { image, schema: verdict ? VERDICT_SCHEMA : undefined, ...options });
  if (verdict) {
    const v = result.structured?.verdict;
    if (!["SCAM", "UNSURE", "OK"].includes(v)) throw new Error("BAD_VERDICT");
    return `${v} ${String(result.structured.reason ?? "").slice(0, 200)}`;
  }
  return result.text;
}
