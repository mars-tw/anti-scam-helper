import { test } from "node:test";
import assert from "node:assert/strict";
import { chatComplete, cloudLlmChain, isLocalLlm } from "../guard/ai-summary.mjs";

test("anthropic summary backend is cloud and sends workspace header", async () => {
  process.env.TEST_ANTH_KEY = "k"; process.env.TEST_ANTH_WS = "ws";
  const node = { backend: "anthropic", model: "m", apiKeyEnv: "TEST_ANTH_KEY", workspaceIdEnv: "TEST_ANTH_WS" };
  assert.equal(isLocalLlm(node), false);
  assert.equal(cloudLlmChain(node).length, 1);
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ content: [{ type: "text", text: " hi " }], usage: { input_tokens: 3, output_tokens: 2 } }) }; };
  const r = await chatComplete(node, "sys", "u", 100, { fetchImpl });
  assert.equal(r.text, "hi"); assert.deepEqual(r.usage, { input: 3, output: 2 });
  assert.match(seen.url, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(seen.opts.headers["anthropic-workspace-id"], "ws");
  assert.equal(JSON.parse(seen.opts.body).system, "sys");
});

test("responses summary backend parses output_text", async () => {
  process.env.TEST_RESP_KEY = "k";
  const node = { backend: "responses", baseUrl: "https://api.example.com/v1", model: "m", apiKeyEnv: "TEST_RESP_KEY" };
  let url;
  const r = await chatComplete(node, "s", "u", 10, { fetchImpl: async (u) => { url = u; return { ok: true, json: async () => ({ output_text: "ok", usage: { input_tokens: 1, output_tokens: 1 } }) }; } });
  assert.equal(r.text, "ok"); assert.match(url, /\/responses$/);
});

test("anthropic without key throws NO_KEY", async () => {
  delete process.env.TEST_MISSING;
  await assert.rejects(chatComplete({ backend: "anthropic", model: "m", apiKeyEnv: "TEST_MISSING" }, "s", "u", 10, { fetchImpl: async () => { throw new Error("no"); } }), /NO_KEY/);
});
