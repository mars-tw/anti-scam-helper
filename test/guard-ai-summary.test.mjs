import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BLOCKED_WORDS } from "../guard/notice.mjs";
import { SummaryState, buildTranscript, chunkLines, estimateCost, estimateTokens, finalizeSummary, mapReduce, parseSummaryCommand, redact } from "../guard/ai-summary.mjs";

const NOW = Date.parse("2026-10-19T00:30:00Z"); // 台北 08:30

test("/ai整理 指令：半形／全形斜線、空白、時間範圍；其他文字不算", () => {
  assert.deepEqual(parseSummaryCommand("/ai整理", NOW), { label: "最近能取得的全部對話" });
  assert.ok(parseSummaryCommand("／AI整理", NOW));
  assert.ok(parseSummaryCommand(" / ai 整理 全部", NOW));
  assert.equal(parseSummaryCommand("/ai整理 今天", NOW).since, Date.parse("2026-10-18T16:00:00Z"));
  assert.equal(parseSummaryCommand("/ai整理 昨天", NOW).since, Date.parse("2026-10-17T16:00:00Z"));
  assert.equal(parseSummaryCommand("/ai整理 3天", NOW).since, NOW - 3 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 ３天", NOW).since, NOW - 3 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 12小時", NOW).since, NOW - 12 * 3_600_000);
  assert.equal(parseSummaryCommand("/ai整理 兩週", NOW).since, NOW - 14 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 999天", NOW).since, NOW - 90 * 86_400_000);
  for (const text of ["幫我 /ai整理", "/ai整理器", "/ai 整 理", "ai整理", "/aiXX整理"]) assert.equal(parseSummaryCommand(text, NOW), null, text);
});

test("token 粗估：中文約 1 字 1 token，英文約 4 字元 1 token", () => {
  assert.equal(estimateTokens("你好世界"), 4);
  assert.equal(estimateTokens("abcdefgh"), 2);
});

test("redact：網址、網域、電話、email、LINE ID、邀請碼、@ 都拿掉", () => {
  const out = redact("看 https://ex.com/a 或 ada.nz/r/x 打 0912-345-678 寄 a@b.com line id: abc_123 邀請碼 AB12CD @小明 你好");
  for (const bad of ["ex.com", "ada.nz", "0912", "a@b.com", "abc_123", "AB12CD", "小明"]) assert.ok(!out.includes(bad), bad);
  assert.match(out, /你好/);
});

test("逐字稿：從新往舊取到預算、按時間排序、詐騙訊息只留標記、記事本有標示", () => {
  const items = [
    { at: 3, name: "乙", text: "第三則" },
    { at: 1, name: "甲", text: "第一則很長很長很長很長很長很長很長很長很長" },
    { at: 2, name: "丙", text: "快加我 line id: scam01 賺錢", flagged: true },
    { at: 4, kind: "note", text: "記事本內容" },
  ];
  const all = buildTranscript(items, 1e6);
  assert.equal(all.lines.length, 4);
  assert.deepEqual(all.lines.map((l) => l.at), [1, 2, 3, 4]);
  assert.match(all.lines[1].line, /疑似詐騙，內容略/);
  assert.ok(!all.lines[1].line.includes("scam01"));
  assert.match(all.lines[3].line, /［記事本］/);
  const small = buildTranscript(items, 60);
  assert.ok(small.lines.length < 4 && small.lines.at(-1).at === 4, "預算不夠時保留最新的");
});

test("切塊不拆單行，每塊不超過上限", () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ line: `L${i}`, tokens: 30 }));
  const chunks = chunkLines(lines, 100);
  assert.equal(chunks.length, 4);
  assert.equal(chunks.join("\n").split("\n").length, 10);
});

test("map-reduce：多塊先平行摘要再合併、失敗會重試、逾時丟錯", async () => {
  const seen = [];
  let fails = 1;
  const complete = async (system, user) => {
    seen.push(system.startsWith("你會拿到") ? "reduce" : "map");
    if (fails-- > 0) throw new Error("HTTP_500");
    return { text: `摘要${seen.length}`, usage: { input: 100, output: 10 } };
  };
  const result = await mapReduce(["a", "b", "c"], { complete, concurrency: 2, retries: 2, sleep: async () => {} });
  assert.equal(result.mapCalls, 3);
  assert.equal(seen.filter((s) => s === "reduce").length, 1);
  assert.equal(result.calls.length, 4);
  const single = await mapReduce(["only"], { complete: async () => ({ text: "x", usage: { input: 1, output: 1 } }) });
  assert.equal(single.calls.length, 1);
  await assert.rejects(mapReduce(["a", "b"], { complete, deadline: Date.now() - 1 }), /TIMEOUT/);
});

test("費用估算：prompt ≥ 20 萬 token 整個請求用長上下文價", () => {
  assert.equal(estimateCost([{ input: 100_000, output: 1000 }]), 0.1275);
  assert.equal(estimateCost([{ input: 200_000, output: 1000 }]), 0.505);
});

test("最終輸出：加（AI代理）、換禁字、去連結、最多兩則且每則不超過上限", () => {
  const [one] = finalizeSummary("【主要話題】\n・大家說要換群到 ex.com（AI代理）", { blockedWords: DEFAULT_BLOCKED_WORDS, title: "📋 群組整理" });
  assert.match(one, /（AI代理）$/);
  assert.equal(one.match(/AI代理/g).length, 1);
  assert.ok(!one.includes("換群") && !one.includes("ex.com"));
  const long = Array.from({ length: 400 }, (_, i) => `【段${i}】這是一段很長的整理內容`).join("\n");
  const parts = finalizeSummary(long, { blockedWords: DEFAULT_BLOCKED_WORDS, maxChars: 1000, maxMessages: 2 });
  assert.equal(parts.length, 2);
  for (const part of parts) { assert.ok(part.length <= 1000, String(part.length)); assert.match(part, /（AI代理）$/); }
  assert.match(parts[0], /（1\/2）/);
});

test("冷卻：每群 10 分鐘一次、存檔重啟不歸零、冷卻中只回一次、同群同時只跑一個", () => {
  const file = join(mkdtempSync(join(tmpdir(), "sum-")), "state.json");
  const T = 1_000_000_000;
  let now = T;
  const state = new SummaryState(file, { now: () => now });
  assert.ok(state.check("c1", 600_000).ok);
  state.start("c1");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(state.check("c1", 600_000).running, true);
  state.finish("c1");
  now = T + 60_000;
  const first = state.check("c1", 600_000);
  assert.equal(first.ok, false);
  assert.equal(first.told, false);
  assert.equal(first.remainingMs, 540_000);
  state.markTold("c1");
  assert.equal(state.check("c1", 600_000).told, true);
  assert.ok(state.check("c2", 600_000).ok);
  const reloaded = new SummaryState(file, { now: () => T + 120_000 });
  assert.equal(reloaded.check("c1", 600_000).ok, false);
  now = T + 600_001;
  assert.ok(new SummaryState(file, { now: () => now }).check("c1", 600_000).ok);
});

test("本人帳號的 /ai整理：守衛自己送的、帶代理標記的不算；整理結果絕不以指令開頭", async () => {
  const { selfSummaryCommand, finalizeSummary, parseSummaryCommand } = await import("../guard/ai-summary.mjs");
  const isBotText = (text) => text.includes("（AI代理）");
  const sentIds = new Set(["sent-1"]);
  assert.ok(selfSummaryCommand("/ai整理", { messageId: "own-1", sentIds, isBotText }));
  assert.ok(selfSummaryCommand("／AI整理 3天", { messageId: "own-2", sentIds, isBotText }));
  assert.equal(selfSummaryCommand("/ai整理", { messageId: "sent-1", sentIds, isBotText }), null);
  assert.equal(selfSummaryCommand("/ai整理 （AI代理）", { messageId: "own-3", sentIds, isBotText }), null);
  assert.equal(selfSummaryCommand("今天大家聊得很熱烈", { messageId: "own-4", sentIds, isBotText }), null);
  const parts = finalizeSummary("/ai整理 這是整理結果\n【主要話題】…", { label: "（AI代理）" });
  for (const part of parts) {
    assert.equal(parseSummaryCommand(part), null);
    assert.ok(!/^[\s/／]/.test(part));
    assert.equal(selfSummaryCommand(part, { messageId: "x", sentIds: new Set(), isBotText }), null);
  }
});

test("點位格式：價格區間不會被當成電話；免責聲明只出現一次、放在最後一則", async () => {
  const { redact, finalizeSummary, SUMMARY_DISCLAIMER, REDUCE_SYSTEM, MAP_SYSTEM } = await import("../guard/ai-summary.mjs");
  assert.equal(redact("BTC 支撐 65000-66000，止損 63500，ETH 0.618 回撤 2450"), "BTC 支撐 65000-66000，止損 63500，ETH 0.618 回撤 2450");
  assert.match(redact("打 0912 345 678 或 02-2345-6789 或 +886 912345678"), /^打 〔電話〕 或 〔電話〕 或 〔電話〕$/);
  for (const head of ["【大家在聊什麼】", "【有人執行什麼】", "【點位整理】", "【交易策略】"]) assert.ok(REDUCE_SYSTEM.includes(head));
  assert.match(MAP_SYSTEM, /絕不推算/);
  const one = finalizeSummary(`【大家在聊什麼】\n・小明：網格\n${SUMMARY_DISCLAIMER}`, { label: "（AI代理）" });
  assert.equal(one.length, 1);
  assert.equal(one[0].split(SUMMARY_DISCLAIMER.replace(/。$/, "")).length - 1, 1);
  assert.ok(one[0].endsWith(`${SUMMARY_DISCLAIMER}（AI代理）`));
  const long = finalizeSummary(Array.from({ length: 400 }, (_, i) => `・第${i}點 小明說了一些很長的內容`).join("\n"), { label: "（AI代理）", maxChars: 2000, maxMessages: 2 });
  assert.equal(long.length, 2);
  assert.ok(!long[0].includes(SUMMARY_DISCLAIMER));
  assert.ok(long[1].includes(SUMMARY_DISCLAIMER));
  for (const part of long) assert.ok(part.length <= 2000);
});
