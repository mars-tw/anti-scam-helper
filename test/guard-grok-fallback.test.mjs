import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { complete } from "../guard/llm.mjs";
import { decideChatKick } from "../guard/policy.mjs";

test("備援順序 Claude A → Claude B → Grok → Meta：Claude 都不能用時由 Grok 回答", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grokfb-"));
  const bin = join(dir, "grok");
  writeFileSync(bin, `#!/bin/sh\necho '{"text":"SCAM 測試","structuredOutput":{"verdict":"SCAM","reason":"測試"}}'\n`);
  chmodSync(bin, 0o755);
  delete process.env.TEST_NO_KEY_A; delete process.env.TEST_NO_KEY_B; delete process.env.TEST_NO_KEY_M;
  const meta = { backend: "responses", model: "meta-test", apiKeyEnv: "TEST_NO_KEY_M" };
  const grok = { backend: "grok-cli", model: "grok-test", bin, workDir: join(dir, "w"), sandbox: "", timeoutMs: 5000, verdict: true, fallback: meta };
  const chain = { backend: "anthropic", model: "claude-a", apiKeyEnv: "TEST_NO_KEY_A", fallback: { backend: "anthropic", model: "claude-b", apiKeyEnv: "TEST_NO_KEY_B", fallback: grok } };
  const used = {};
  const answer = await complete(chain, "sys", "訊息", 60, undefined, used);
  assert.match(answer, /^SCAM/);
  assert.equal(used.model, "grok-test");
});

test("Grok 當第一層：踢人群只通知，不踢", () => {
  assert.equal(decideChatKick({ score: 8, strongScore: 6, verdict: "SCAM", model: "grok-4.7-build-fast", review: "SCAM" }), "notice");
});
test("Grok 當覆核：跟 Meta 一樣，有回應才算數", () => {
  const base = { score: 8, strongScore: 6, verdict: "SCAM", model: "claude-haiku-5-5" };
  assert.equal(decideChatKick({ ...base, review: "SCAM" }), "kick");
  assert.equal(decideChatKick({ ...base, review: "OK" }), "notice");
  assert.equal(decideChatKick({ ...base, review: "UNSURE" }), "notice");
  assert.equal(decideChatKick({ ...base, review: undefined }), "kick");
});
