import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearnExtStore, buildDigestInput, replyChains, sectionLabel, cleanDescription, cleanNotes, digestDue, digestDate, makeHourlyCap, readLatestNotes, writeNotes, localDate, LEARN_EXT_DEFAULTS } from "../guard/learn-ext.mjs";
import { blockedForLearnOnly, learnExtChats } from "../guard/policy.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "learnext-"));

test("預設上限：每小時 20 張圖、每次 10 個討論串、每串 50 則、每 60 分鐘跑一次", () => {
  assert.equal(LEARN_EXT_DEFAULTS.imagesPerHour, 20);
  assert.equal(LEARN_EXT_DEFAULTS.threadsPerRun, 10);
  assert.equal(LEARN_EXT_DEFAULTS.threadMessages, 50);
  assert.equal(LEARN_EXT_DEFAULTS.intervalMinutes, 60);
});
test("每小時上限：滿了就擋，過一小時再放行", () => {
  let t = 0; const cap = makeHourlyCap(2, { now: () => t });
  assert.equal(cap.take(), true); assert.equal(cap.take(), true); assert.equal(cap.take(), false);
  t = 3_600_000; assert.equal(cap.take(), true);
});
test("只學習群：延伸學習只放行讀圖，發送／刪除／踢人照擋；沒開延伸學習的連讀圖也擋", () => {
  const chats = new Set(["mA", "mB"]); const mediaChats = new Set(["mA"]);
  assert.equal(blockedForLearnOnly({ type: "media:fetch", chatId: "mA" }, chats, { mediaChats }), false);
  assert.equal(blockedForLearnOnly({ type: "media:fetch", chatId: "mB" }, chats, { mediaChats }), true);
  for (const type of ["message:send", "message:delete", "member:remove", "message:react", "scam:check", "chat:read"]) assert.equal(blockedForLearnOnly({ type, chatId: "mA" }, chats, { mediaChats }), true, type);
  assert.equal(blockedForLearnOnly({ type: "thread:fetch", chatId: "mA" }, chats, { mediaChats }), false);
});
test("learnExt 只對 learnOnly 的群生效", () => {
  const set = learnExtChats({ a: { learnOnly: true, learnExt: true }, b: { learnExt: true }, c: { learnOnly: true } });
  assert.deepEqual([...set], ["a"]);
});
test("討論串結構去識別化：串、回覆、發言者都是雜湊，不留原 id", () => {
  const dir = tmp(); const s = new LearnExtStore(dir, { salt: "x" });
  assert.equal(s.add({ kind: "thread", chatId: "mCHAT", messageId: "1", senderId: "pSENDER", threadId: "tTHREAD001", root: true, text: "開串問題" }), true);
  assert.equal(s.add({ kind: "thread", chatId: "mCHAT", messageId: "2", senderId: "pOTHER", threadId: "tTHREAD001", replyTo: "1", text: "回覆內容" }), true);
  assert.equal(s.add({ kind: "thread", chatId: "mCHAT", messageId: "2", threadId: "tTHREAD001", text: "重複" }), false);
  const raw = readFileSync(join(dir, "items.jsonl"), "utf8");
  for (const id of ["mCHAT", "pSENDER", "pOTHER", "tTHREAD001"]) assert.equal(raw.includes(id), false, id);
  const [a, b] = s.since("mCHAT");
  assert.equal(a.thread, b.thread); assert.equal(b.replyTo, a.mid); assert.equal(a.root, true);
  assert.equal(statSync(join(dir, "items.jsonl")).mode & 0o777, 0o600);
  assert.equal(new LearnExtStore(dir, { salt: "x" }).has("2"), true);
});
test("圖片描述：去掉網址、帳號、email、@、電話與人臉描述", () => {
  const out = cleanDescription("描述：一張設定頁截圖，網址 https://evil.example/x ，LINE ID: abc123\n人臉：一位戴眼鏡的男性\n技術重點：寄信到 a@b.com，@小明 說打 0912-345-678", {});
  for (const bad of ["https://", "abc123", "a@b.com", "@小明", "0912", "戴眼鏡"]) assert.equal(out.includes(bad), false, bad);
  assert.match(out, /設定頁/);
});
test("筆記：長引號換成［略］、暱稱換掉", () => {
  const out = cleanNotes("## 主題\n- 小美說「這是一段很長很長很長很長很長的原文句子」", { names: ["小美"] });
  assert.equal(out.includes("小美"), false);
  assert.match(out, /［略］/);
});
test("整理輸入：分一般訊息、討論串（同串同代號、↳ 回覆）、圖片描述", () => {
  const { text, counts } = buildDigestInput({ messages: [{ text: "大家好", bot: true }], extItems: [
    { kind: "thread", thread: "h1", root: true, text: "怎麼部署" }, { kind: "thread", thread: "h1", replyTo: "x", text: "用 systemd" },
    { kind: "image", text: "描述：架構圖" } ] });
  assert.deepEqual(counts, { messages: 1, threadMessages: 2, threads: 1, images: 1, audits: 0 });
  assert.match(text, /\[串1\]（開串） 怎麼部署/); assert.match(text, /\[串1\] ↳ 用 systemd/); assert.match(text, /（機器人）大家好/);
});
test("筆記寫在本機（600），latest.md 讀得到；每天一次，手動觸發一律寫", () => {
  const dir = tmp(); const day = localDate();
  const late = new Date(); late.setHours(23, 30, 0, 0);
  assert.equal(digestDue(dir, { now: late.getTime(), digestHour: 23 }), true);
  writeNotes(dir, day, "## 主題\n- 測試", { messages: 3 });
  assert.equal(statSync(join(dir, `${day}.md`)).mode & 0o777, 0o600);
  assert.match(readLatestNotes(dir), /學習筆記/);
  assert.equal(digestDue(dir, { now: late.getTime(), digestHour: 23 }), false);
  assert.equal(digestDue(dir, { force: true }), true);
  const early = new Date(); early.setHours(1, 0, 0, 0);
  assert.equal(digestDue(tmp(), { now: early.getTime(), digestHour: 23 }), false);
  assert.equal(existsSync(join(dir, "latest.md")), true);
});

test("回覆串：依 replyTo 找串頭；沒回覆關係的不算；串頭在這頁外就用它的 id", () => {
  const msgs = [{ messageId: "1" }, { messageId: "2", replyTo: "1" }, { messageId: "3", replyTo: "2" }, { messageId: "4" }, { messageId: "5", replyTo: "99" }];
  const out = replyChains(msgs).map((x) => [x.message.messageId, x.rootId, x.root]);
  assert.deepEqual(out, [["1", "1", true], ["2", "1", false], ["3", "1", false], ["5", "99", false]]);
});
test("整理輸入：回覆串跟討論串一起算", () => {
  const { counts } = buildDigestInput({ extItems: [{ kind: "reply", thread: "r1", root: true, text: "問" }, { kind: "reply", thread: "r1", replyTo: "a", text: "答" }] });
  assert.equal(counts.threads, 1); assert.equal(counts.threadMessages, 2);
});

test("筆記保留 Markdown 換行；沒列進 names 的本帳號名字不會被換掉", () => {
  const out = cleanNotes("## 主題\n- 第一點\n- 第二點\n\n## 可以改進阿華的地方\n- 回短一點", { names: ["小美"] });
  assert.equal(out.split("\n").length, 6);
  assert.match(out, /可以改進阿華的地方/);
});

test("筆記分節：用自訂的去識別化群名稱，沒設就用群 N，不接受換行或標題符號", () => {
  assert.equal(sectionLabel({ learnExtLabel: "技術交流群" }, 0), "技術交流群");
  assert.equal(sectionLabel({}, 1), "群 2");
  assert.equal(sectionLabel({ learnExtLabel: "# 壞\n名" }, 0), "壞名");
});

test("10/27 補寫：過午夜才跑、昨天筆記沒寫 → 補昨天；第一次啟用、昨天已寫都不補", () => {
  const at = (d, h) => { const x = new Date(2026, 9, d, h, 5, 0, 0); return x.getTime(); };
  const dir = tmp();
  writeNotes(dir, "2026-10-25", "## 主題\n- a", {});
  assert.equal(digestDate(dir, { now: at(27, 0), digestHour: 23 }), "2026-10-26");
  assert.equal(digestDue(dir, { now: at(27, 0), digestHour: 23 }), true);
  writeNotes(dir, "2026-10-26", "## 主題\n- b", {});
  assert.equal(digestDate(dir, { now: at(27, 0), digestHour: 23 }), undefined);
  assert.equal(digestDate(dir, { now: at(27, 23), digestHour: 23 }), "2026-10-27");
  assert.equal(digestDate(tmp(), { now: at(27, 0), digestHour: 23 }), undefined);
  assert.equal(digestDate(tmp(), { now: at(27, 23), digestHour: 23 }), "2026-10-27");
  assert.equal(digestDate(dir, { now: at(27, 0), digestHour: 23, force: true }), "2026-10-27");
});
