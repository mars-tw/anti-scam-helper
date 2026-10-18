import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTopics, fetchText, groundingPrompt, groundTopic, KnowledgeCache, loadTopics, matchTopic, pickRelevant, toPlainText } from "../guard/knowledge.mjs";

const topics = loadTopics(new URL("../guard/knowledge.topics.json", import.meta.url));

test("主題清單：內建 MiniMax H3，只有 https 官方網址", () => {
  const h3 = topics.find((t) => t.id === "minimax-h3");
  assert.ok(h3);
  assert.ok(h3.sources.length >= 3);
  for (const s of h3.sources) assert.match(s.url, /^https:\/\/([a-z0-9-]+\.)*(minimax\.io|huggingface\.co|githubusercontent\.com)\//);
});

test("H3 觸發：各種問法都算", () => {
  for (const q of ["H3 好用嗎", "h3 模型要多少顯卡", "@阿軒 minimax h3 可以商用嗎", "MiniMax-H3 開源了？", "有人跑過H3嗎", "海螺 H3 跟 Sora 比？", "H3-Base FL2VA 怎麼用", "請問 H3 的 ComfyUI 工作流", "H3？"]) {
    assert.equal(matchTopic(q, topics)?.id, "minimax-h3", q);
  }
});

test("H3 不誤觸發：HTML 標題、HTTP/3、Uber H3、代碼、流感", () => {
  for (const q of ["<h3> 標籤怎麼置中", "h3 標題字太大", "CSS 的 h3 要怎麼改顏色", "HTTP/3 跟 h3 alpn 是什麼", "Uber H3 六角格怎麼用", "H3N2 流感", "訂單 AH3 到了", "型號 H32 還有貨嗎", "abc.com/h3 是什麼", "今天天氣如何", "### 標題"]) {
    assert.equal(matchTopic(q, topics), undefined, q);
  }
  // 明確說 MiniMax H3 時，就算提到 HTML 也算。
  assert.equal(matchTopic("MiniMax H3 能輸出 html 嗎", topics)?.id, "minimax-h3");
});

test("主題清單格式不對：略過，不丟錯", () => {
  assert.deepEqual(compileTopics([{ id: "x", match: ["("], sources: [{ url: "https://a.example/" }] }, { id: "y", match: ["y"], sources: [{ url: "http://insecure.example/" }] }, null]), []);
  assert.deepEqual(loadTopics("/nonexistent/topics.json"), []);
});

test("HTML 轉純文字：去掉 script／style、保留表格與段落", () => {
  const text = toPlainText("<html><head><title>x</title></head><body><script>alert(1)</script><style>p{}</style><h1>MiniMax H3</h1><p>Output&nbsp;duration &amp; 4&ndash;15 s</p><table><tr><td>FPS</td><td>24</td></tr></table></body></html>", "text/html");
  assert.ok(!text.includes("alert"));
  assert.ok(text.includes("MiniMax H3"));
  assert.ok(text.includes("Output duration & 4–15 s"));
  assert.match(text, /FPS \| 24/);
  const md = toPlainText("---\nlicense: other\n---\n# Title\n![img](a.png) see [docs](https://x.y) \\- ok", "text/plain");
  assert.equal(md, "# Title\nsee docs - ok");
});

function fakeResponse(body, { status = 200, type = "text/plain", location } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : k.toLowerCase() === "location" ? location : null) }, text: async () => body };
}

test("抓頁面：只抓允許的主機、限大小、跟轉址到別的主機就拒絕", async () => {
  const allow = new Set(["ok.example"]);
  const got = await fetchText("https://ok.example/a", { allowHosts: allow, maxBytes: 10, fetchImpl: async () => fakeResponse("0123456789ABCDEF") });
  assert.equal(got.text, "0123456789");
  assert.equal(await fetchText("https://evil.example/a", { allowHosts: allow, fetchImpl: async () => fakeResponse("x") }), undefined);
  assert.equal(await fetchText("http://ok.example/a", { allowHosts: allow, fetchImpl: async () => fakeResponse("x") }), undefined);
  assert.equal(await fetchText("https://ok.example/a", { allowHosts: allow, fetchImpl: async () => fakeResponse("", { status: 302, location: "https://evil.example/b" }) }), undefined);
  assert.equal(await fetchText("https://ok.example/a", { allowHosts: allow, fetchImpl: async () => fakeResponse("x", { type: "image/png" }) }), undefined);
  assert.equal(await fetchText("https://ok.example/a", { allowHosts: allow, fetchImpl: async () => { throw new Error("down"); } }), undefined);
});

const PAGE = `# MiniMax H3\nMiniMax H3 is an open-source video model.\n\n${"filler text about nothing. ".repeat(40)}\n\nOutput duration: 4-15 seconds. Frame rate 24 FPS.\n\nLicense: MiniMax H3 Community License, royalty-free commercial use.\n\nGPU: SGLang quickstart uses 8 x NVIDIA B200.`;

test("快取：新的直接用、過期就重抓、抓不到用舊快取、都沒有回 undefined；檔案 600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-"));
  try {
    let now = Date.parse("2026-10-18T00:00:00Z");
    let calls = 0;
    let fail = false;
    const cache = new KnowledgeCache(dir, { ttlHours: 24, now: () => now, fetchImpl: async () => { calls++; if (fail) throw new Error("down"); return fakeResponse(PAGE); } });
    const source = { label: "t", url: "https://ok.example/readme" };
    const allow = new Set(["ok.example"]);
    const first = await cache.get(source, allow);
    assert.equal(first.fromCache, false);
    assert.equal(calls, 1);
    assert.equal(statSync(cache.file(source.url)).mode & 0o777, 0o600);
    const second = await cache.get(source, allow);
    assert.equal(second.fromCache, true);
    assert.equal(calls, 1);
    now += 25 * 3_600_000; fail = true;
    const stale = await cache.get(source, allow);
    assert.equal(calls, 2);
    assert.equal(stale.fresh, false);
    assert.ok(stale.text.includes("B200"));
    assert.equal(await cache.get({ label: "n", url: "https://ok.example/none" }, allow), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function topicFor(url) {
  return compileTopics([{ id: "t", title: "MiniMax H3", match: ["h3"], hints: [{ when: "顯卡|gpu", add: "GPU B200" }, { when: "商用|授權", add: "license commercial" }], sources: [{ label: "官方 README", url }] }])[0];
}

test("挑段落：依問題（含中文 hints）挑到相關段", () => {
  const picked = pickRelevant([{ text: PAGE }], "H3 要多少顯卡", topicFor("https://ok.example/r"), 400);
  assert.ok(picked.some((c) => c.text.includes("B200")), JSON.stringify(picked));
  assert.ok(!picked.some((c) => c.text.startsWith("filler")));
});

test("第一層：地端模型整理成事實；地端失敗改用原文摘錄；都抓不到回 ok=false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-"));
  try {
    const topic = topicFor("https://ok.example/r");
    const cache = new KnowledgeCache(dir, { fetchImpl: async () => fakeResponse(PAGE) });
    let seen = "";
    const g = await groundTopic({ topic, question: "H3 可以商用嗎", cache, summarize: async (system, user) => { seen = user; return "- 授權是 MiniMax H3 Community License，可免版稅商用 [1]"; } });
    assert.equal(g.ok, true);
    assert.equal(g.via, "local-summary");
    assert.ok(seen.includes("royalty-free"));
    assert.ok(g.facts.includes("Community License"));
    assert.ok(g.excerpts.includes("royalty-free"));
    const prompt = groundingPrompt(topic, g);
    assert.ok(prompt.includes("Community License") && prompt.includes("以原文為準") && prompt.includes("不要自己補"));
    assert.ok(!/https?:\/\//.test(prompt), "提示裡不放網址");

    const g2 = await groundTopic({ topic, question: "H3 可以商用嗎", cache, summarize: async () => { throw new Error("local down"); } });
    assert.equal(g2.via, "snippets");
    assert.ok(g2.excerpts.includes("royalty-free"));

    const empty = new KnowledgeCache(join(dir, "empty"), { fetchImpl: async () => { throw new Error("offline"); } });
    const g3 = await groundTopic({ topic: topicFor("https://ok.example/other"), question: "H3?", cache: empty, summarize: async () => "x".repeat(30) });
    assert.equal(g3.ok, false);
    const cautious = groundingPrompt(topic, g3);
    assert.ok(cautious.includes("查不到") && cautious.includes("不要編造"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
