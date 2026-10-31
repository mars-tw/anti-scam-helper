import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
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
  state.commit("c1");
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

test("SummaryState：沒送出就不佔冷卻；重啟時清掉進行中標記", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sum-")), "state.json");
  const T = 2_000_000_000;
  let now = T;
  const state = new SummaryState(file, { now: () => now });
  state.start("c1");
  now += 30_000;
  state.finish("c1"); // 失敗：沒 commit
  assert.ok(state.check("c1", 600_000).ok);
  state.start("c2"); // 當機：沒 finish
  const reloaded = new SummaryState(file, { now: () => now });
  assert.ok(reloaded.check("c2", 600_000).ok);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).c2, undefined);
  reloaded.start("c3");
  now += 70_000;
  reloaded.commit("c3");
  reloaded.finish("c3");
  const after = reloaded.check("c3", 600_000);
  assert.equal(after.ok, false);
  assert.equal(after.remainingMs, 600_000 - 70_000); // 從開始整理起算
});

test("SummaryState：本人不受冷卻限制，其他人照舊；同一群整理中仍只跑一份", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sum-")), "state.json");
  let now = 3_000_000_000;
  const state = new SummaryState(file, { now: () => now });
  state.start("g"); state.commit("g"); state.finish("g");
  now += 60_000;
  assert.equal(state.check("g", 600_000).ok, false);
  assert.equal(state.check("g", 600_000, { owner: true }).ok, true);
  state.markTold("g");
  assert.equal(state.check("g", 600_000, { owner: true }).ok, true);
  state.start("g");
  assert.equal(state.check("g", 600_000, { owner: true }).running, true);
  state.finish("g");
});

test("整理樣式：交易群用 strategy（結論／點位／策略邏輯蒸餾＋免責），其他群用 gist（只整理重點）", async () => {
  const { summaryProfileFor, SUMMARY_PROFILES, finalizeSummary, mapReduce, SUMMARY_DISCLAIMER } = await import("../guard/ai-summary.mjs");
  const cfg = { profiles: { strategy: ["cTrade1", "cTrade2"] }, defaultProfile: "gist" };
  assert.equal(summaryProfileFor("cTrade1", cfg).name, "strategy");
  assert.equal(summaryProfileFor("cTrade2", cfg).name, "strategy");
  assert.equal(summaryProfileFor("cOther", cfg).name, "gist");
  assert.equal(summaryProfileFor("cOther", {}).name, "full"); // 沒設定＝舊格式
  assert.equal(summaryProfileFor("cX", { profiles: { nope: ["cX"] }, defaultProfile: "nope" }).name, "full");
  const s = SUMMARY_PROFILES.strategy;
  for (const head of ["【結論】", "【點位】", "【策略邏輯蒸餾】", "未提到", "絕不推算", "未具名", "閒聊"]) assert.ok(s.reduce.includes(head), head);
  for (const field of ["進場", "止盈", "止損", "加倉", "時間框架"]) assert.ok(s.reduce.includes(field), field);
  assert.ok(!SUMMARY_PROFILES.gist.reduce.includes("【點位】"));
  assert.ok(SUMMARY_PROFILES.gist.reduce.includes("【重點整理】") && SUMMARY_PROFILES.gist.reduce.includes("未具名"));
  for (const p of Object.values(SUMMARY_PROFILES)) assert.ok(!p.reduce.includes("換群"));
  // 結尾：strategy＝免責＋（AI代理）；gist＝只有（AI代理）
  const [st] = finalizeSummary("【結論】\n・看多 https://ex.com", { label: "（AI代理）", disclaimer: s.disclaimer });
  assert.ok(st.endsWith("僅為群內發言整理，非投資建議。（AI代理）"));
  assert.ok(!st.includes("ex.com"));
  const [gi] = finalizeSummary("【重點整理】\n・大家在聊午餐", { label: "（AI代理）", disclaimer: SUMMARY_PROFILES.gist.disclaimer });
  assert.ok(gi.endsWith("・大家在聊午餐（AI代理）") && !gi.includes(SUMMARY_DISCLAIMER));
  // mapReduce 用樣式給的提示詞
  const seen = [];
  const complete = async (system, user) => { seen.push(system); return { text: "ok", usage: { input: 1, output: 1 } }; };
  await mapReduce(["a", "b"], { complete, mapSystem: s.map, reduceSystem: s.reduce, sleep: async () => {} });
  assert.equal(seen.filter((x) => x === s.map).length, 2);
  assert.ok(seen.at(-1).startsWith(s.reduce.split("{MAX}")[0]) && !seen.at(-1).includes("{MAX}"));
});

test("交易群兩則：策略整理後接聊天重點；其他群只有一則；附加樣式只看設定", async () => {
  const { summaryPlanFor, FOLLOWUP_PROFILES, finalizeSummary } = await import("../guard/ai-summary.mjs");
  const cfg = { profiles: { strategy: ["cTrade1", "cTrade2"] }, defaultProfile: "gist", followups: { strategy: "chat" } };
  assert.deepEqual(summaryPlanFor("cTrade1", cfg).map((p) => [p.name, p.role]), [["strategy", "primary"], ["chat", "followup"]]);
  assert.deepEqual(summaryPlanFor("cTrade2", cfg).map((p) => p.name), ["strategy", "chat"]);
  assert.deepEqual(summaryPlanFor("cOther", cfg).map((p) => p.name), ["gist"]);
  assert.deepEqual(summaryPlanFor("cTrade1", { profiles: cfg.profiles }).map((p) => p.name), ["strategy"]); // 沒設定 followups＝只有一則
  assert.deepEqual(summaryPlanFor("cTrade1", { ...cfg, followups: { strategy: "nope" } }).map((p) => p.name), ["strategy"]);
  const chat = FOLLOWUP_PROFILES.chat;
  assert.ok(chat.reduce.includes("【聊天重點】") && chat.reduce.includes("3～5 點"));
  for (const word of ["點位", "交易策略", "不要重複", "未具名"]) assert.ok(chat.reduce.includes(word), word);
  assert.ok(!chat.reduce.includes("換群") && !chat.map.includes("換群"));
  assert.equal(chat.disclaimer, "");
  // 結尾只有（AI代理）、不加免責；禁字替換；不以指令開頭
  const [c1] = finalizeSummary("/ai整理\n【聊天重點】\n・小明說要換群 https://x.co", { label: "（AI代理）", disclaimer: chat.disclaimer, blockedWords: DEFAULT_BLOCKED_WORDS });
  assert.ok(c1.endsWith("（AI代理）") && !c1.includes("非投資建議") && !c1.includes("換群") && c1.includes("假群組") && !c1.includes("x.co"));
  assert.equal(parseSummaryCommand(c1), null);
  // 每份各自最多 2 則
  const long = Array.from({ length: 400 }, (_, i) => `・第${i}點 閒聊內容很長很長`).join("\n");
  const parts = finalizeSummary(`【聊天重點】\n${long}`, { label: "（AI代理）", disclaimer: "", maxChars: 1500, maxMessages: 2 });
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 1500 && p.endsWith("（AI代理）")));
});

test("兩則送出判定：主整理有送出才冷卻；附加整理失敗或沒送完記 partial；主整理沒送出就不送附加", async () => {
  const { summaryDelivery, shouldSendFollowup } = await import("../guard/ai-summary.mjs");
  assert.deepEqual(summaryDelivery([{ total: 1, sent: 1 }, { total: 1, sent: 1 }]), { commit: true, status: "ok" });
  assert.deepEqual(summaryDelivery([{ total: 1, sent: 1 }]), { commit: true, status: "ok" });
  assert.deepEqual(summaryDelivery([{ total: 2, sent: 2 }, { total: 1, sent: 0 }]), { commit: true, status: "partial" });
  assert.deepEqual(summaryDelivery([{ total: 1, sent: 1 }, { total: 0, sent: 0, error: "TIMEOUT" }]), { commit: true, status: "partial" });
  assert.deepEqual(summaryDelivery([{ total: 2, sent: 1 }, { total: 1, sent: 1 }]), { commit: true, status: "partial" });
  assert.deepEqual(summaryDelivery([{ total: 1, sent: 0 }, { total: 1, sent: 0, skipped: true }]), { commit: false, status: "failed" });
  assert.equal(shouldSendFollowup(0), false);
  assert.equal(shouldSendFollowup(1), true);
});

test("格式檢查：缺必要段落、Markdown 標題或表格都算不符；不符會帶提醒重寫一次", async () => {
  const { summaryFormatOk, SUMMARY_PROFILES, FOLLOWUP_PROFILES, mapReduce, finalizeSummary } = await import("../guard/ai-summary.mjs");
  const st = SUMMARY_PROFILES.strategy;
  const good = "【結論】\n・看多\n\n【點位】\n・BTC｜多｜100｜小明｜10/19 10:00\n\n【策略邏輯蒸餾】\n・小明｜BTC｜多：…";
  assert.equal(summaryFormatOk(good, st), true);
  assert.equal(summaryFormatOk("整理範圍是…\n\n## 記事本\n\n| 時間 | 內容 |\n|---|---|", st), false);
  assert.equal(summaryFormatOk(`${good}\n## 其他`, st), false);
  assert.equal(summaryFormatOk("【結論】\n・a\n【策略邏輯蒸餾】\n・b", st), false); // 缺【點位】
  assert.equal(summaryFormatOk("【聊天重點】\n・午餐吃炒飯", FOLLOWUP_PROFILES.chat), true);
  assert.equal(summaryFormatOk("## 社群動態\n- 午餐", FOLLOWUP_PROFILES.chat), false);
  assert.equal(summaryFormatOk("【重點整理】\n・a", SUMMARY_PROFILES.gist), true);
  for (const p of [st, SUMMARY_PROFILES.gist, SUMMARY_PROFILES.full, FOLLOWUP_PROFILES.chat]) assert.ok(p.reminder && !p.reminder.includes("換群"));
  // 單塊：第一次亂寫 → 帶提醒重寫 → 通過
  const users = [];
  let n = 0;
  const complete = async (system, user) => { users.push(user); n++; return { text: n === 1 ? "## 亂寫\n| a | b |" : good, usage: { input: 1, output: 1 } }; };
  const out = await mapReduce(["紀錄"], { complete, reduceSystem: st.reduce, reminder: st.reminder, validate: (t) => summaryFormatOk(t, st), sleep: async () => {} });
  assert.equal(out.text, good);
  assert.equal(out.formatOk, true);
  assert.equal(out.rewrites, 1);
  assert.ok(users[0].endsWith(st.reminder));
  assert.ok(users[1].includes("沒有照指定格式"));
  // 一直不符：只重寫 formatRetries 次，回 formatOk=false（呼叫端照送並記錄）
  let calls = 0;
  const bad = await mapReduce(["a", "b"], { complete: async () => { calls++; return { text: "## 不聽話", usage: { input: 1, output: 1 } }; }, mapSystem: st.map, reduceSystem: st.reduce, validate: (t) => summaryFormatOk(t, st), sleep: async () => {} });
  assert.equal(bad.formatOk, false);
  assert.equal(calls, 2 + 2); // 兩塊 map ＋ 合併 ＋ 重寫一次
  // 沒給 validate：行為照舊
  const plain = await mapReduce(["x"], { complete: async () => ({ text: "ok", usage: { input: 1, output: 1 } }), sleep: async () => {} });
  assert.equal(plain.formatOk, true);
  assert.equal(plain.rewrites, 0);
  // 最後輸出把 Markdown 標題與粗體拿掉
  const [p] = finalizeSummary("## 標題\n**粗體**內容", { label: "（AI代理）", disclaimer: "" });
  assert.ok(!p.includes("##") && !p.includes("**") && p.includes("粗體內容"));
});
