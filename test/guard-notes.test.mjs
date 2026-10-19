import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRuleScorer } from "../guard/rules.mjs";
import { DEFAULT_BLOCKED_WORDS } from "../guard/notice.mjs";
import { NotesSeen, buildNoteNotice, decideNoteAction, noteKey, noteSnippet, noteText } from "../guard/notes.mjs";

// 虛構的範例（不是真實記事本）：空格拆字的「假解散、搬新社團」＋短網址。
const SPACED = "由 於 廣 告 太 多   本 群 將 於 明 日 解 散   請 大 家 移 到 新 社 團   感 謝 配 合\nada.nz/r/AbC";
const score = makeRuleScorer();

test("記事本假解散：空格拆字＋短網址 ≥ 6 分（Meta 掛掉也夠通知門檻）", () => {
  for (const text of [SPACED, noteText(SPACED)]) {
    const r = score({ senderName: "某人" }, text);
    assert.ok(r.score >= 6, `${r.score} ${r.names}`);
    assert.ok(r.names.includes("短網址"));
  }
  for (const text of ["本社群明天關閉，請大家前往新群 https://cutt.us/xyz", "廣告太多 本群組決定解散 請大家加入新群組 surl.li/abc"]) {
    assert.ok(score({}, text).score >= 6, text);
  }
});

test("記事本假解散：一般公告不會被當成假解散", () => {
  assert.ok(score({}, "本週六社團聚餐，地點在台北車站，歡迎參加").score < 3);
  assert.ok(score({}, "廣告太多的話請檢舉，管理員會處理").score < 3);
});

test("noteText 拿掉中文字間的空白，網址不動", () => {
  assert.equal(noteText("因 為 群 內　廣 告"), "因為群內廣告");
  assert.match(noteText(SPACED), /ada\.nz\/r\/AbC/);
});

test("noteSnippet：去掉連結／ID／電話，禁字換掉，限長", () => {
  const s = noteSnippet(`${SPACED} 請換群 line id: abc123 0912345678`, DEFAULT_BLOCKED_WORDS, 200);
  assert.doesNotMatch(s, /ada\.nz|abc123|0912345678/);
  assert.match(s, /〔連結〕/);
  assert.doesNotMatch(s, /換群/);
  assert.ok([...noteSnippet(SPACED, DEFAULT_BLOCKED_WORDS)].length <= 31);
});

test("decideNoteAction：比照訊息，但不踢人；Meta 掛掉 ≥6 只通知；管理員作者不動", () => {
  const base = { strongScore: 6, notifyScore: 3 };
  assert.equal(decideNoteAction({ ...base, score: 10, verdict: "SCAM", review: "UNAVAILABLE" }), "notify");
  assert.equal(decideNoteAction({ ...base, score: 5, verdict: "SCAM", review: "UNAVAILABLE" }), "none");
  assert.equal(decideNoteAction({ ...base, score: 3, verdict: "SAFE", review: "SCAM" }), "notify");
  assert.equal(decideNoteAction({ ...base, score: 10, verdict: "SCAM", review: "SAFE" }), "none");
  assert.equal(decideNoteAction({ ...base, score: 10, verdict: "SCAM", review: "SCAM", protectedAuthor: true }), "none");
  // 刪除：開關、管理員群、服務支援、雙模型 SCAM 全部要有
  const all = { ...base, score: 10, verdict: "SCAM", review: "SCAM", deleteOnConfirmed: true, canDelete: true, deleteSupported: true };
  assert.equal(decideNoteAction(all), "delete");
  assert.equal(decideNoteAction({ ...all, deleteSupported: false }), "notify");
  assert.equal(decideNoteAction({ ...all, canDelete: false }), "notify");
  assert.equal(decideNoteAction({ ...all, verdict: "UNSURE" }), "notify");
  assert.equal(decideNoteAction({ ...all, review: "UNAVAILABLE" }), "notify");
});

test("buildNoteNotice：@ 群主／管理員位置正確、換禁字、帶 AI 不承諾內容", () => {
  const admins = [["p1", { name: "群主", role: "admin" }], ["p2", { name: "管理員乙", role: "coAdmin" }]];
  const { text, mentions } = buildNoteNotice({ snippet: "因為群內廣告太多…", authorName: "換群小王", admins }, DEFAULT_BLOCKED_WORDS);
  for (const m of mentions) assert.equal(text.slice(m.start, m.end)[0], "@");
  assert.equal(text.slice(mentions[0].start, mentions[0].end), "@群主");
  assert.doesNotMatch(text, /換群/);
  assert.match(text, /記事本/);
  assert.match(text, /（AI代理）/);
  assert.match(text, /請群主與管理員留意/);
});

test("NotesSeen：檔案 600、記住 baseline、版本鍵含更新時間", () => {
  const file = join(mkdtempSync(join(tmpdir(), "notes-")), "seen.json");
  const seen = new NotesSeen(file, { now: () => 1000 });
  assert.equal(seen.baseline, 1000);
  const key = noteKey("c", { postId: "p", createdAt: 1 });
  seen.add(key);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const again = new NotesSeen(file, { now: () => 9999 });
  assert.equal(again.baseline, 1000);
  assert.ok(again.has(key));
  assert.notEqual(noteKey("c", { postId: "p", createdAt: 1, updatedAt: 2 }), key);
});

test("本帳號能踢人的群：通知不 @ 群主／管理員；不是管理員的群照舊 @", async () => {
  const { selfIsChatAdmin, mentionTargets } = await import("../guard/policy.mjs");
  const admins = new Map([["p-boss", { name: "群主", role: "admin" }], ["p-me", { name: "我", role: "coAdmin" }]]);
  assert.equal(selfIsChatAdmin(admins, (id) => id === "p-me"), true);
  assert.equal(selfIsChatAdmin(admins, (id) => id === "p-other"), false);
  assert.equal(selfIsChatAdmin(undefined, () => true), false);
  const list = [["p-boss", { name: "群主", role: "admin" }]];
  assert.deepEqual(mentionTargets(list, true), []);
  assert.deepEqual(mentionTargets(list, false), list);
  const { text, mentions } = buildNoteNotice({ snippet: "x", admins: mentionTargets(list, true) }, DEFAULT_BLOCKED_WORDS);
  assert.equal(mentions.length, 0);
  assert.doesNotMatch(text, /@/);
});
