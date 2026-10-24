import test from "node:test";
import assert from "node:assert/strict";
import { complete } from "../guard/llm.mjs";

const node = { backend: "anthropic", model: "claude-haiku-5-5", apiKeyEnv: "TEST_ANTH_KEY", workspaceIdEnv: "TEST_ANTH_WS", timeoutMs: 5000 };

test("anthropic backend 送原生 /v1/messages 並帶 workspace header", async () => {
  process.env.TEST_ANTH_KEY = "k"; process.env.TEST_ANTH_WS = "wrkspc_x";
  const orig = globalThis.fetch; let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ content: [{ type: "text", text: "你好" }] }), { status: 200 }); };
  try {
    const used = {};
    const out = await complete(node, "sys", "hi", 50, undefined, used);
    assert.equal(out, "你好"); assert.equal(used.model, "claude-haiku-5-5");
    assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
    assert.equal(seen.init.headers["x-api-key"], "k");
    assert.equal(seen.init.headers["anthropic-workspace-id"], "wrkspc_x");
    assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
    const body = JSON.parse(seen.init.body); assert.equal(body.system, "sys"); assert.equal(body.max_tokens, 50);
  } finally { globalThis.fetch = orig; }
});

test("anthropic 失敗時改用 fallback", async () => {
  process.env.TEST_ANTH_KEY = "k";
  const orig = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url) => { calls++; if (String(url).includes("anthropic")) return new Response("{}", { status: 500 }); return new Response(JSON.stringify({ choices: [{ message: { content: "備援" } }] }), { status: 200 }); };
  try {
    const out = await complete({ ...node, fallback: { backend: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKeyEnv: "" } }, "s", "u", 10);
    assert.equal(out, "備援"); assert.equal(calls, 2);
  } finally { globalThis.fetch = orig; }
});

test("沒金鑰就直接跳過到 fallback，不送請求", async () => {
  delete process.env.TEST_ANTH_KEY;
  const orig = globalThis.fetch; const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); };
  try {
    assert.equal(await complete({ ...node, fallback: { backend: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKeyEnv: "" } }, "s", "u", 10), "ok");
    assert.ok(urls.every((u) => !u.includes("anthropic")));
  } finally { globalThis.fetch = orig; }
});
