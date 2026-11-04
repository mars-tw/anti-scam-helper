// 11/4 守門員日報兩個漏擋＋grok EXIT_1／learn-ext 重試。內容皆為改寫後的假例（不放真實 ID、暱稱、網域）。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bandanLineOaAction, hasLineOaForm, isBandanLineOa, isLineOaUrl, hasBandanLure } from "../guard/line-oa-bandan.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";
import { grokCli, resetGrokCliState } from "../guard/grok-cli.mjs";

const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");

// ---- 1) 看圖：帶單截圖＋接著貼 LINE 官方綠色 QR ----
const LURE_IMG = "圖中有「老師帶單」、保證3萬變150萬、私訊及短網址引流，並承諾進群帶單。";
const OA_QR_IMG = "圖中是 LINE 官方綠色 QR code，屬於引流加好友。";

test("看圖：帶單圖後接 LINE 官方 QR（同人 2 分鐘內）→ 命中帶單老師 LINE@", () => {
  assert.equal(isBandanLineOa(OA_QR_IMG, { contextText: LURE_IMG, vision: true }), true);
});
test("看圖：只有 LINE 官方 QR、前面沒有帶單語意 → 不命中", () => {
  assert.equal(isBandanLineOa(OA_QR_IMG, { vision: true }), false);
});
test("看圖：只有帶單圖、沒有 LINE@ 形式 → 不命中（照舊走一般看圖通知）", () => {
  assert.equal(isBandanLineOa(LURE_IMG, { vision: true }), false);
});
test("對抗：一般文字提到「LINE 官方帳號」不靠 vision 放寬（仍要 @ID／連結）", () => {
  assert.equal(hasLineOaForm("老師說 LINE 官方帳號 很好用"), false);
  assert.equal(isBandanLineOa("老師帶單很猛，LINE 官方帳號 有公告", {}), false);
});
test("對抗：看圖理由否定句（無 QR、無 LINE）不算 LINE@", () => {
  assert.equal(hasLineOaForm("圖為百分比試算表，無QR、LINE、網址或招攬內容", { vision: true }), false);
  assert.equal(isBandanLineOa("老師帶單截圖，沒有 LINE 官方 QR", { vision: true }), false);
});
test("對抗：交易所官方跟單教學圖＋官方 QR → 不命中", () => {
  assert.equal(isBandanLineOa("派網跟單交易教學，附 LINE 官方帳號 QR", { vision: true }), false);
});
test("對抗：商家穩賺優惠＋LINE 官方 QR → 不命中", () => {
  assert.equal(isBandanLineOa("雙11 穩賺優惠，掃 LINE 官方帳號 QR 領券", { vision: true }), false);
});
test("看圖路徑有傳 vision:true；併案會一起刪前一則（只刪不踢）", () => {
  assert.match(src, /handleBandanLineOa\(ws, message, reason, \{ vision: true \}\)/);
  assert.match(src, /bandan-line-oa-prior-deleted/);
  assert.doesNotMatch(src.slice(src.indexOf("async function handleBandanLineOa"), src.indexOf("// scamLink.deleteOnConfirmed")), /kickMember|member:kick|type: "kick/);
});
test("先記再判：noteBandanLure 會保留被蓋掉的前一則（prior），併案找得到", () => {
  assert.match(src, /prior = prev && Date\.now\(\) - prev\.at <= COMBO_WINDOW_MS/);
  assert.match(src, /e\.messageId === message\.messageId \? e\.prior : e/);
});

// ---- cooldown 不吞處置 ----
test("cooldown：刪文路徑不看通知有沒有送出（notifyThenAct 一律執行刪文）、通知路徑先記錄再通知", () => {
  const body = src.slice(src.indexOf("async function handleBandanLineOa"), src.indexOf("// scamLink.deleteOnConfirmed"));
  assert.match(body, /notifyThenAct\(\(\) => notifyAdmins\(ws, entry, "link-delete"\), async \(\) => \{\s*answer = await call\(ws, \{ type: "message:delete"/);
  const flag = body.indexOf('record({ action: "suspect-flag"');
  const notifyAt = body.indexOf('await notifyAdmins(ws, entry, "suspect")');
  assert.ok(flag > 0 && notifyAt > flag);
  const notice = readFileSync(new URL("../guard/notice.mjs", import.meta.url), "utf8");
  assert.match(notice, /notified = Boolean\(await notify\(\)\); \} catch \{ notified = false; \}\s*await sleep\(delayMs\);\s*await act\(notified\);/);
  assert.match(src, /action: "notify-skipped", reason: "cooldown", kind, chatId: entry\.chatId, messageId: entry\.messageId/);
});

// ---- 三種群：踢人群／非踢人群／Hao0321 只警告群 ----
test("三種群處置：永不踢；只警告群、熊群、學習群不刪", () => {
  for (const cfg of [{}, { deleteMessage: true }]) {
    const kickGroup = bandanLineOaAction({ ...cfg, canDelete: true });
    const normalGroup = bandanLineOaAction({ ...cfg, canDelete: true });
    const hao = bandanLineOaAction({ ...cfg, warnOnly: true, canDelete: true });
    const bear = bandanLineOaAction({ ...cfg, excludeChat: true, canDelete: false });
    const learn = bandanLineOaAction({ ...cfg, learnOnly: true });
    for (const a of [kickGroup, normalGroup, hao, bear, learn]) assert.equal(a.kick, false);
    assert.equal(hao.delete, false); assert.equal(hao.notice, true);
    assert.equal(bear.delete, false); assert.equal(learn.delete, false); assert.equal(learn.notice, false);
    assert.equal(kickGroup.delete, cfg.deleteMessage === true);
  }
});

// ---- 2) 多帳號貼同一則「推薦老師」＋短網址 → 展開到 LINE@ ----
const RECOMMEND = "聊天記錄真實可查，我為大家推薦的老師能力可自行驗證，這是剛才貼圖的老師： s.example/abc12 老師目前學員不多，不用被主力當韭菜";
test("推薦老師＋學員不多 算帶單語意；展開到 LINE@ 命中", () => {
  assert.equal(hasBandanLure(RECOMMEND), true);
  assert.equal(isBandanLineOa(`${RECOMMEND}\nhttps://line.me/R/ti/p/@fakeoa123`), true);
  assert.equal(isBandanLineOa(RECOMMEND), false); // 沒展開前沒有 LINE@ 形式
});
test("對抗：一般分享推薦老師的課程（無 LINE@）不命中；一般投資聊天＋LINE@ 但無老師語意不命中", () => {
  assert.equal(isBandanLineOa("推薦老師的這本書，很適合新手 https://books.example/x"), false);
  assert.equal(isBandanLineOa("台股今天大漲，記帳 App 官方 https://line.me/R/ti/p/@fakeshop1"), false);
});
test("對抗：交易所官方 LINE@ 白名單、品牌跟單教學不受推薦老師字樣影響之外仍放行", () => {
  assert.equal(isBandanLineOa("派網官方 LINE@ 跟單交易教學 https://page.line.me/021gojrr"), false);
});
test("isLineOaUrl：@ID／lin.ee／page.line.me 是；個人 ti/p/~ 與群組 ti/g 不是", () => {
  assert.equal(isLineOaUrl("https://line.me/R/ti/p/@fakeoa123"), true);
  assert.equal(isLineOaUrl("https://lin.ee/AbCd12"), true);
  assert.equal(isLineOaUrl("https://page.line.me/fakeoa123"), true);
  assert.equal(isLineOaUrl("https://line.me/ti/p/~someone"), false);
  assert.equal(isLineOaUrl("https://line.me/ti/g/abcdef"), false);
});
test("expandUrlSafe：短網址 302 到 line.me/R/ti/p/@ → lineOa，不再抓 LINE 頁", async () => {
  const hits = [];
  const fetchImpl = async (u) => {
    hits.push(String(u));
    return { status: 302, headers: { get: (k) => (k.toLowerCase() === "location" ? "https://line.me/R/ti/p/@fakeoa123" : null), has: () => false } };
  };
  const r = await expandUrlSafe("https://s.example/abc12", { fetchImpl, resolve: async () => [{ address: "93.184.216.34" }] });
  assert.equal(r.lineOa, true);
  assert.match(r.url, /ti\/p\/@fakeoa123/);
  assert.equal(hits.length, 1);
});
test("expandUrlSafe：個人 ti/p/~ 不標 lineOa（照舊走加好友溫和備註）", async () => {
  let n = 0;
  const fetchImpl = async () => (n++ === 0
    ? { status: 302, headers: { get: (k) => (k.toLowerCase() === "location" ? "https://line.me/ti/p/~someone" : null), has: () => false } }
    : { status: 200, ok: true, headers: { get: () => "text/plain", has: () => false }, body: null });
  const r = await expandUrlSafe("https://s.example/abc12", { fetchImpl, resolve: async () => [{ address: "93.184.216.34" }] });
  assert.notEqual(r?.lineOa, true);
});
test("guard：兩個短網址展開入口都接到帶單 LINE@，且不加分數、不踢", () => {
  assert.equal((src.match(/expanded\?\.lineOa && isLineOaUrl\(expanded\.url\)/g) ?? []).length, 2);
  assert.match(src, /handleBandanLineOa\(ws, message, text, \{ expandedUrl: expanded\.url \}\)/);
});

// ---- 3) grok EXIT_1（402 額度用完）與 learn-ext 重試 ----
function fakeSpawn({ code = 0, stdout = "", stderr = "" } = {}, calls = []) {
  return () => {
    calls.push(1);
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setTimeout(() => { if (stdout) child.stdout.emit("data", stdout); if (stderr) child.stderr.emit("data", stderr); child.emit("close", code); }, 2);
    return child;
  };
}
const gcfg = () => ({ backend: "grok-cli", workDir: mkdtempSync(join(tmpdir(), "grokq-")), bin: "/fake/grok", sandbox: "" });
test("grok：stderr 有 402 → QUOTA 並暫停（下一次直接 GROK_DISABLED，不再起 CLI）", async () => {
  resetGrokCliState();
  const calls = []; const t = 1_000_000;
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fakeSpawn({ code: 1, stderr: "api error status 402 Payment Required" }, calls), now: () => t }), /QUOTA/);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fakeSpawn({ code: 0, stdout: "{\"text\":\"ok\"}" }, calls), now: () => t + 60_000 }), /GROK_DISABLED/);
  assert.equal(calls.length, 1);
  resetGrokCliState();
});
test("grok：沒寫原因的 EXIT_1 連續 3 次才暫停；中間成功一次歸零", async () => {
  resetGrokCliState();
  const calls = []; let t = 2_000_000;
  const fail = fakeSpawn({ code: 1 }, calls); const ok = fakeSpawn({ stdout: "{\"text\":\"ok\"}" }, calls);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fail, now: () => t }), /EXIT_1/);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fail, now: () => t }), /EXIT_1/);
  assert.equal((await grokCli(gcfg(), "S", "x", { spawnImpl: ok, now: () => t })).text, "ok");
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fail, now: () => t }), /EXIT_1/);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fail, now: () => t }), /EXIT_1/);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: fail, now: () => t }), /EXIT_1/);
  await assert.rejects(grokCli(gcfg(), "S", "x", { spawnImpl: ok, now: () => t + 60_000 }), /GROK_DISABLED/);
  assert.equal((await grokCli(gcfg(), "S", "x", { spawnImpl: ok, now: () => t + 16 * 60_000 })).text, "ok");
  resetGrokCliState();
});
test("learn-ext 拉歷史失敗會重試（最多 3 次）", () => {
  assert.match(src, /for \(let attempt = 0; attempt < 3; attempt\+\+\) \{\s*page = await call\(ws, \{ type: "history:fetch", chatId, limit: 100 \}, 180_000\);/);
  assert.match(src, /learn-ext-history-failed", chatId, code: page\.code, attempts: 3/);
});
