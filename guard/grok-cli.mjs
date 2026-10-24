// 用主機上已登入的 Grok CLI（本人自己的 grok.com 訂閱）當備援模型：headless 單次（grok -p），
// 空的工作目錄＋沙箱設定檔（只讀系統路徑與 ~/.grok，讀不到專案、設定與 env），關掉所有工具、網路搜尋與子代理。
// 不讀、不碰 CLI 的登入檔；登入由 CLI 自己更新。環境變數只給 HOME 與 PATH（不把任何金鑰傳給它）。
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// 沙箱設定檔（~/.grok/sandbox.toml 的 [profiles.guard]）：deny 只能列「存在」的路徑——
// bwrap 遮蔽不存在的路徑時要先建立掛載點，在 / 底下會 Permission denied（主機重開後 /cursor 不一定掛上），整個呼叫就 EXIT_1。
// 所以每次呼叫前依現況重寫這一段（內容沒變就不寫）。
export function guardSandboxDeny(home = homedir(), exists = existsSync) {
  return ["/workspace", join(home, ".config"), "/cursor", join(home, ".pm2"), join(home, ".ssh")].filter((path) => exists(path));
}
export function renderGuardProfile(name, home = homedir(), deny = guardSandboxDeny(home)) {
  return `[profiles.${name}]\nextends = "strict"\nrestrict_network = true\nread_write = [${JSON.stringify(join(home, ".grok"))}]\ndeny = [${deny.map((d) => JSON.stringify(d)).join(", ")}]\n`;
}
/** 回傳新的檔案內容（只換掉 [profiles.<name>] 那一段，其他設定保留）。 */
export function upsertProfile(toml, name, block) {
  const lines = String(toml ?? "").split("\n");
  const header = `[profiles.${name}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return `${String(toml ?? "").replace(/\n*$/, toml ? "\n\n" : "")}${block}`;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const rest = lines.slice(end).join("\n");
  return `${lines.slice(0, start).join("\n")}${start ? "\n" : ""}${block}${rest ? `\n${rest}` : ""}`;
}
export function ensureSandboxProfile(name = GROK_CLI_DEFAULTS.sandbox, home = homedir()) {
  const file = join(home, ".grok", "sandbox.toml");
  let current = "";
  try { current = readFileSync(file, "utf8"); } catch {}
  const next = upsertProfile(current || "# 反詐守衛呼叫 grok -p 用的沙箱：只讀系統路徑、空的工作目錄與 ~/.grok，不讀專案、設定與 env。\n", name, renderGuardProfile(name, home));
  if (next !== current) { try { writeFileSync(file, next, { mode: 0o644 }); } catch {} }
}

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
  // /tmp 重開機會清空：每次呼叫都確保工作目錄與沙箱設定存在且正確。
  mkdirSync(cfg.workDir, { recursive: true, mode: 0o700 });
  try { chmodSync(cfg.workDir, 0o700); } catch {}
  if (spawnImpl === spawn && cfg.sandbox) ensureSandboxProfile(cfg.sandbox);
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
      // 錯誤碼只帶分類，不帶內容（stderr 可能有提示詞或路徑）。
      if (/bwrap|sandbox/i.test(out.stderr)) throw new Error(`SANDBOX_EXIT_${out.code}`);
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

/** Grok CLI 的工作階段目錄名稱：把 cwd 的「/」編成 %2F（~/.grok/sessions/%2Ftmp%2Fgrok-guard）。 */
export function grokSessionDir(workDir = GROK_CLI_DEFAULTS.workDir, home = homedir()) {
  return join(home, ".grok", "sessions", encodeURIComponent(workDir));
}

/**
 * 清掉守衛自己（cwd = workDir）留下、超過 maxAgeDays 天沒動的 Grok 工作階段。
 * 只動 grokSessionDir(workDir) 底下的子目錄／檔案，其他專案的工作階段不碰。回傳刪掉的數量。
 */
export function cleanGrokSessions({ workDir = GROK_CLI_DEFAULTS.workDir, maxAgeDays = 7, home = homedir(), now = Date.now() } = {}) {
  const dir = grokSessionDir(workDir, home);
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  const cutoff = now - maxAgeDays * 86_400_000;
  let removed = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}
