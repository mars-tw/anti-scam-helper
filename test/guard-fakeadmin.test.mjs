// 假冒管理員偵測的純函式。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { analyzeName, avatarUrl, fakeAdminVerdict, parseAvatarAnswer, pruneAvatarCache } from "../guard/fakeadmin.mjs";
import { complete } from "../guard/llm.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const types = (name) => analyzeName(name).signals.map((s) => s.type).sort().join(",");

test("自稱管理員／小幫手／客服／官方：含拆字、全形、假字母", () => {
  for (const name of ["管理員小美", "管 理 員", "管_理_員", "小幫手- 小美", "小帮手", "客服專員", "官方LINE", "群主", "Admin Team", "a.d.m.i.n", "аdmіn", "ＡＤＭＩＮ", "Official"]) assert.match(types(name), /staff/, name);
});

test("一般暱稱不算（含 emoji ZWJ、LINE 表情佔位字、badminton）", () => {
  for (const name of ["北極熊🐻‍❄️", "👨‍👩‍👧小美", "❤️阿明", "￼小雨", "Amy.lin", "badminton王", "Tom 林", "阿德（摸魚中）", "Neo-陪跑x入門", "🏳️‍🌈Leo"]) assert.equal(types(name), "", name);
});

test("看不見的字元、空白暱稱、假徽章、大量裝飾符號", () => {
  assert.equal(types("\u3164"), "blank,invisible");
  assert.equal(types("\u200b\u200b"), "blank,invisible");
  assert.equal(types("\u2800"), "blank,invisible");
  assert.equal(types("阿\u200b明"), "invisible");
  assert.equal(types("阿\uE001明"), "invisible");
  assert.equal(types("S̷̢̛a̴m̸"), "invisible");
  assert.equal(types("👑阿明"), "badge");
  assert.equal(types("【官方】小美"), "badge,staff");
  assert.equal(types("~*~*~"), "decor");
});

test("判定：暱稱單一訊號 vs 強訊號；頭像單獨不到踢人等級", () => {
  const v = (name, crown) => fakeAdminVerdict(analyzeName(name).signals, crown);
  assert.deepEqual([v("管理員小美").fake, v("管理員小美").byName, v("管理員小美").strong], [true, true, false]);
  assert.equal(v("管理員\u200b").strong, true);
  assert.equal(v("👑阿明").fake, false);
  assert.equal(v("👑阿明").weak, true);
  assert.equal(v("\u200b阿明\u200b👑").byName, true); // 看不見＋徽章
  // 頭像皇冠沒有同群冒名 → 完全不算（10/21 自拍誤判）
  assert.deepEqual([v("阿明", true).fake, v("阿明", true).weak], [false, false]);
  assert.deepEqual([v("👑阿明", true).byName, v("👑阿明", true).strong], [false, false]);
  const g = (name, crown) => fakeAdminVerdict(analyzeName(name).signals, crown, true);
  assert.deepEqual([g("阿明", true).fake, g("阿明", true).byName], [true, false]);
  assert.deepEqual([g("👑阿明", true).byName, g("👑阿明", true).strong], [true, true]);
  assert.equal(g("阿明", false).fake, false);
  assert.equal(v("阿明").fake, false);
});

test("頭像網址、模型回答解析、快取修剪", () => {
  assert.equal(avatarUrl("avatar-o-0hAbCdEfGh12"), "https://obs.line-scdn.net/0hAbCdEfGh12/preview");
  assert.equal(avatarUrl("avatar-p-abcdefgh"), "https://profile.line-scdn.net/abcdefgh/preview");
  assert.equal(avatarUrl("msg-123"), undefined);
  assert.equal(avatarUrl("avatar-o-../../x"), undefined);
  assert.equal(parseAvatarAnswer("YES\n頭像有皇冠和管理員字樣"), true);
  assert.equal(parseAvatarAnswer("YES 這是虛構角色的劇情圖片，非 LINE 官方或管理員認證圖像"), false);
  assert.equal(parseAvatarAnswer("YES\n貓咪"), false);
  assert.equal(parseAvatarAnswer("no"), false);
  assert.equal(parseAvatarAnswer("嗯"), undefined);
  const cache = { a: { crown: true, at: 0 }, b: { crown: false, at: 100 }, c: { crown: false, at: 200 } };
  pruneAvatarCache(cache, 150, 120, 5);
  assert.deepEqual(Object.keys(cache), ["b", "c"]);
  pruneAvatarCache(cache, 150, 1000, 1);
  assert.deepEqual(Object.keys(cache), ["c"]);
});

test("規則加權：拆字的「小 幫 手」暱稱也算自稱管理員", () => {
  const score = makeRuleScorer();
  const r = score({ senderName: "小 幫 手" }, "請大家搬到新群");
  assert.ok(r.names.includes("暱稱自稱管理員"));
});

test("Meta 覆核鏈：contributor、wonder 都失敗 → 改用標準版 muse-spark-1.3", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const model = JSON.parse(body).model;
      seen.push(model);
      if (model !== "muse-spark-1.3") { res.statusCode = 404; return res.end("{}"); }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ output_text: "SCAM\n換群詐騙" }));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const node = (model, fallback) => ({ backend: "responses", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model, apiKeyEnv: "", ...(fallback ? { fallback } : {}) });
  const chain = node("muse-spark-1.3-contributor", node("muse-wonder-1.0", node("muse-spark-1.3")));
  const used = {};
  const answer = await complete(chain, "sys", "訊息", 20, undefined, used);
  server.close();
  assert.equal(answer, "SCAM\n換群詐騙");
  assert.equal(used.model, "muse-spark-1.3");
  assert.deepEqual(seen, ["muse-spark-1.3-contributor", "muse-wonder-1.0", "muse-spark-1.3"]);
});

test("覆核鏈第 4 層 xAI Grok：Meta 三個都失敗 → Grok 判定（文字與圖片），Grok 沒金鑰就整串失敗只記錄", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const json = JSON.parse(body);
      seen.push({ path: req.url, model: json.model, image: JSON.stringify(json.messages ?? "").includes("image_url") });
      if (req.url.startsWith("/meta")) { res.statusCode = 404; return res.end("{}"); }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "SCAM 假紅包" } }] }));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const meta = (model, fallback) => ({ backend: "responses", baseUrl: `${base}/meta/v1`, model, apiKeyEnv: "", fallback });
  const grok = { backend: "openai", baseUrl: `${base}/xai/v1`, model: "grok-4.20-0309-non-reasoning", apiKeyEnv: "TEST_FAKE_XAI_KEY", maxTokensField: "max_tokens" };
  const chain = meta("muse-spark-1.3-contributor", meta("muse-wonder-1.0", meta("muse-spark-1.3", grok)));
  process.env.TEST_FAKE_XAI_KEY = "fake";
  const used = {};
  assert.equal(await complete(chain, "sys", "訊息", 20, undefined, used), "SCAM 假紅包");
  assert.equal(used.model, "grok-4.20-0309-non-reasoning");
  const usedImage = {};
  assert.equal(await complete(chain, "sys", "圖", 20, { mime: "image/png", base64: "AAAA" }, usedImage), "SCAM 假紅包");
  assert.equal(seen.at(-1).image, true);
  delete process.env.TEST_FAKE_XAI_KEY;
  seen.length = 0;
  const none = {};
  assert.equal(await complete(chain, "sys", "訊息", 20, undefined, none), undefined);
  assert.equal(none.model, undefined);
  assert.ok(seen.every((s) => s.path.startsWith("/meta")), "沒金鑰不送 xAI");
  server.close();
});

test("頭像誤判成皇冠＋叫人私聊、暱稱沒冒名：不通知；暱稱冒同群管理員＋皇冠：照舊", () => {
  const plain = fakeAdminVerdict(analyzeName("小東").signals, true, false);
  assert.equal(plain.fake, false);
  assert.equal(plain.strong, false);
  assert.equal(plain.weak, false);
  assert.ok(!plain.labels.some((l) => l.includes("頭像")));
  const imp = fakeAdminVerdict(analyzeName("測試群主").signals, true, true);
  assert.equal(imp.fake, true);
  assert.ok(imp.labels.some((l) => l.includes("頭像")));
  const impBadge = fakeAdminVerdict(analyzeName("👑測試群主").signals, true, true);
  assert.deepEqual([impBadge.byName, impBadge.strong], [true, true]);
});
