import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokArgs, grokCli, grokCliText, resetGrokCliState } from "../guard/grok-cli.mjs";

function fakeSpawn({ code = 0, stdout = "", stderr = "", delay = 5 } = {}, calls = []) {
  return (bin, args, options) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    setTimeout(() => {
      if (stdout) child.stdout.emit("data", stdout);
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("close", code);
    }, delay);
    return child;
  };
}
const cfg = () => ({ backend: "grok-cli", workDir: mkdtempSync(join(tmpdir(), "grokcli-")), bin: "/fake/grok" });

test("參數：空工作目錄＋沙箱、關工具／搜尋／子代理、單回合、JSON 輸出；環境只給 HOME、PATH", async () => {
  const args = grokArgs({ workDir: "/tmp/x", sandbox: "guard", effort: "low" }, { promptFile: "/tmp/x/p.txt", system: "S", model: "m", schema: { type: "object" } });
  for (const flag of ["--sandbox", "--disallowed-tools", "--disable-web-search", "--no-subagents", "--max-turns", "--output-format", "--system-prompt-override", "--json-schema", "--cwd"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--max-turns") + 1], "1");
  assert.match(args[args.indexOf("--disallowed-tools") + 1], /run_terminal_cmd/);
  const calls = [];
  resetGrokCliState();
  const c = cfg();
  await grokCli(c, "S", "訊息", { spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "hi", usage: { input_tokens: 3, output_tokens: 1 }, total_cost_usd: 0.001 }) }, calls) });
  assert.deepEqual(Object.keys(calls[0].options.env).sort(), ["HOME", "PATH"]);
  assert.equal(calls[0].options.cwd, c.workDir);
  assert.deepEqual(readdirSync(c.workDir), [], "提示檔用完就刪");
});

test("判定題：JSON schema 回 SCAM／UNSURE／OK，轉成第一個字是判定的文字；格式不對丟錯", async () => {
  resetGrokCliState();
  const ok = await grokCliText({ ...cfg(), verdict: true }, "S", "訊息", 60, undefined, { spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "", structuredOutput: { verdict: "SCAM", reason: "假解散" } }) }) });
  assert.equal(ok, "SCAM 假解散");
  const fromText = await grokCliText({ ...cfg(), verdict: true }, "S", "訊息", 60, undefined, { spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "{\"verdict\":\"OK\",\"reason\":\"閒聊\"}" }) }) });
  assert.equal(fromText, "OK 閒聊");
  await assert.rejects(grokCliText({ ...cfg(), verdict: true }, "S", "x", 60, undefined, { spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "", structuredOutput: { verdict: "MAYBE", reason: "" } }) }) }), /BAD_VERDICT/);
});

test("登入失效：記一次、暫停 30 分鐘不再叫 CLI，不當掉；逾時會砍掉子程序", async () => {
  resetGrokCliState();
  let logged = 0;
  const calls = [];
  const t = 1_000_000;
  const auth = fakeSpawn({ code: 1, stderr: "Error: not logged in, please run grok login" }, calls);
  await assert.rejects(grokCli(cfg(), "S", "x", { spawnImpl: auth, now: () => t, onAuthError: () => logged++ }), /AUTH/);
  await assert.rejects(grokCli(cfg(), "S", "x", { spawnImpl: auth, now: () => t + 60_000, onAuthError: () => logged++ }), /GROK_DISABLED/);
  assert.equal(calls.length, 1);
  assert.equal(logged, 1);
  resetGrokCliState();
  await assert.rejects(grokCli({ ...cfg(), timeoutMs: 20 }, "S", "x", { spawnImpl: fakeSpawn({ stdout: "{}", delay: 200 }) }), /TIMEOUT/);
});

test("圖片：用 ACP image 區塊、改用看圖模型；太大就不送", async () => {
  resetGrokCliState();
  const calls = [];
  await grokCli({ ...cfg(), imageModel: "grok-4.7" }, "S", "看圖", { image: { mime: "image/png", base64: "AAAA" }, spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "OK" }) }, calls) });
  const args = calls[0].args;
  assert.equal(args[args.indexOf("-m") + 1], "grok-4.7");
  assert.equal(JSON.parse(args[args.indexOf("--prompt-json") + 1])[0].type, "image");
  await assert.rejects(grokCli({ ...cfg(), maxImageBase64: 3 }, "S", "x", { image: { mime: "image/png", base64: "AAAA" }, spawnImpl: fakeSpawn() }), /IMAGE_TOO_LARGE/);
});
