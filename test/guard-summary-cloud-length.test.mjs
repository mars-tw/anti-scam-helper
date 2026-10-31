import { test } from "node:test";
import assert from "node:assert/strict";
import { SUMMARY_PROFILES, FOLLOWUP_PROFILES, cloudComplete, cloudLlmChain, isLocalLlm, mapReduce, rewriteHint, summaryFormatOk, summaryLength } from "../guard/ai-summary.mjs";

const local = { backend: "openai", baseUrl: "http://127.0.0.1:8090/v1", model: "qwen" };
const grok = { backend: "grok-cli", model: "grok" };
const xai = { backend: "openai", baseUrl: "https://api.x.ai/v1", model: "g" };

test("地端模型判定", () => {
  assert.equal(isLocalLlm(local), true); assert.equal(isLocalLlm({ backend: "ollama" }), true);
  assert.equal(isLocalLlm(grok), false); assert.equal(isLocalLlm(xai), false);
});
test("整理鏈跳過地端、保留雲端備援", () => {
  const chain = cloudLlmChain({ ...local, fallback: { ...grok, fallback: local } }, xai);
  assert.deepEqual(chain.map((n) => n.backend + (n.baseUrl ?? "")), ["grok-cli", "openaihttps://api.x.ai/v1"]);
  assert.equal(cloudLlmChain(local).length, 0);
});
test("cloudComplete 絕不呼叫地端；主雲端失敗用備援", async () => {
  const used = [];
  const one = async (n) => { used.push(n.model); if (n.model === "grok") throw new Error("x"); return { text: "ok" }; };
  assert.equal((await cloudComplete([grok, local, xai], "s", "u", 1, { completeOne: one })).text, "ok");
  assert.deepEqual(used, ["grok", "g"]);
  await assert.rejects(cloudComplete([], "s", "u", 1), /NO_CLOUD_LLM/);
});
test("字數上限：小天地第一則 600、第二則與其他群 300", () => {
  assert.equal(SUMMARY_PROFILES.strategy.maxLength, 600);
  assert.equal(FOLLOWUP_PROFILES.chat.maxLength, 300);
  assert.equal(SUMMARY_PROFILES.gist.maxLength, 300);
  const long = `【重點整理】\n・${"字".repeat(320)}。`;
  assert.equal(summaryFormatOk(long, SUMMARY_PROFILES.gist), false);
  assert.match(rewriteHint(long, SUMMARY_PROFILES.gist), /精簡版.*完整句子/);
  assert.equal(summaryFormatOk("【重點整理】\n・短。", SUMMARY_PROFILES.gist), true);
  assert.equal(summaryLength("a b\nc"), 3);
});
test("太長時請模型重寫精簡版（不是程式切字）", async () => {
  const outs = [`【重點整理】\n・${"長".repeat(400)}。`, "【重點整理】\n・精簡後的完整句子。"];
  const prompts = [];
  const r = await mapReduce(["x"], { complete: async (s, u) => { prompts.push(u); return { text: outs.shift() }; }, validate: (t) => summaryFormatOk(t, SUMMARY_PROFILES.gist),
    maxLength: 300, hint: (t) => rewriteHint(t, SUMMARY_PROFILES.gist), formatRetries: 2, reduceSystem: SUMMARY_PROFILES.gist.reduce, sleep: async () => {} });
  assert.equal(r.text, "【重點整理】\n・精簡後的完整句子。"); assert.equal(r.rewrites, 1);
  assert.match(prompts[1], /超過 300 字上限/);
});
test("提示詞保留格式要求並要求完整句子、可合併未提到", () => {
  const s = SUMMARY_PROFILES.strategy.reduce;
  for (const k of ["【結論】", "【點位】", "【策略邏輯蒸餾】", "未提到", "其餘未提到", "完整句子"]) assert.ok(s.includes(k), k);
  assert.ok(s.includes("不超過 {MAX} 字"));
});
