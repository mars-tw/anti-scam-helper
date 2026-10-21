import assert from "node:assert/strict";
import test from "node:test";
import { safeMentionTargets, safeName, scrubNotice, sendNotice, stripMentions } from "../guard/notice.mjs";

test("禁字「換群」（含空白拆字）會被替換", () => {
  assert.equal(scrubNotice("請不要換群"), "請不要假群組");
  assert.equal(scrubNotice("換 群了"), "假群組了");
  assert.equal(scrubNotice("違規字", ["違規"]), "＊字");
  assert.equal(scrubNotice("沒事"), "沒事");
});

test("暱稱去掉網址、ID 樣式與禁字，限制長度", () => {
  assert.equal(safeName("管理員小美"), "管理員小美");
  assert.equal(safeName("小美 bit.ly/abc"), "小美");
  assert.equal(safeName("加我 id1234567"), "加我");
  assert.equal(safeName("換群通知"), "假群組通知");
  assert.equal(safeName(""), "某位成員");
  assert.ok(safeName("很".repeat(40)).length <= 20);
});

function fakeServer(results) {
  const frames = [];
  return { frames, send: async (frame) => { frames.push(frame); return results.shift() ?? { type: "error", code: "X" }; } };
}

test("通知先引用那則訊息並 @；成功就只送一次", async () => {
  const server = fakeServer([{ type: "sent", messageId: "1" }]);
  const result = await sendNotice(server.send, { chatId: "c", text: "t", mentions: [{ userId: "u", start: 0, end: 2 }], replyTo: "999" });
  assert.equal(server.frames.length, 1);
  assert.equal(server.frames[0].replyTo, "999");
  assert.ok(server.frames[0].mentions);
  assert.equal(result.replied, true);
});

test("伺服器拒絕時依序退成：只 @ → 只引用 → 純文字", async () => {
  const server = fakeServer([{ type: "error", code: "INVALID_REQUEST" }, { type: "error", code: "INVALID_REQUEST" }, { type: "error", code: "SEND_FAILED" }, { type: "sent", messageId: "2" }]);
  const result = await sendNotice(server.send, { chatId: "c", text: "t", mentions: [{ userId: "u", start: 0, end: 2 }], replyTo: "999" });
  assert.deepEqual(server.frames.map((f) => [Boolean(f.replyTo), Boolean(f.mentions)]), [[true, true], [false, true], [true, false], [false, false]]);
  assert.equal(result.answer.type, "sent");
  assert.equal(result.replied, false);
});

test("逾時或限流就停，不重送（避免重複發）", async () => {
  for (const code of ["TIMEOUT", "RATE_LIMITED"]) {
    const server = fakeServer([{ type: "error", code }, { type: "sent" }]);
    await sendNotice(server.send, { chatId: "c", text: "t", replyTo: "9" });
    assert.equal(server.frames.length, 1, code);
  }
});

test("沒有 replyTo／mentions 時不產生重複嘗試", async () => {
  const server = fakeServer([{ type: "error", code: "X" }, { type: "sent" }]);
  await sendNotice(server.send, { chatId: "c", text: "t" });
  assert.equal(server.frames.length, 1);
});

import { notifyThenAct } from "../guard/notice.mjs";

test("先通知、等一下、再處置（刪除／踢人）", async () => {
  const order = [];
  const notified = await notifyThenAct(async () => { order.push("notify"); return true; }, async (ok) => { order.push(`act:${ok}`); }, 2000, async (ms) => { order.push(`sleep:${ms}`); });
  assert.deepEqual(order, ["notify", "sleep:2000", "act:true"]);
  assert.equal(notified, true);
});

test("通知失敗（或丟錯）也照樣處置，並回報沒通知到", async () => {
  const order = [];
  const notified = await notifyThenAct(async () => { throw new Error("boom"); }, async (ok) => { order.push(`act:${ok}`); }, 10, async () => {});
  assert.deepEqual(order, ["act:false"]);
  assert.equal(notified, false);
});

test("@ 送不出去時，退回的版本不留「@名字」純文字", async () => {
  const text = "⚠️ 反詐小幫手：「Pan ⠀⠀⠀⠀」的訊息疑似詐騙\n@Pan 請群主與管理員留意";
  const start = text.indexOf("@Pan");
  const mentions = [{ userId: "pOWNER", start, end: start + 4 }];
  const server = fakeServer([{ type: "error", code: "INVALID_REQUEST" }, { type: "error", code: "INVALID_REQUEST" }, { type: "sent", messageId: "3" }]);
  const result = await sendNotice(server.send, { chatId: "c", text, mentions, replyTo: "9" });
  assert.equal(server.frames[0].text, text);
  assert.ok(!server.frames[2].mentions);
  assert.ok(!server.frames[2].text.includes("@"));
  assert.ok(server.frames[2].text.endsWith("\n請群主與管理員留意"));
  assert.equal(result.mentioned, false);
  assert.equal(result.replied, true);
});

test("stripMentions 刪掉多個 @ 段落", () => {
  const text = "x\n@A @B 請留意";
  assert.equal(stripMentions(text, [{ userId: "a", start: 2, end: 4 }, { userId: "b", start: 5, end: 7 }]), "x\n請留意");
});

test("@ 對象排除被判詐騙者本人與暱稱含隱形字元者，只留真群主 mid", () => {
  const admins = [["pOWNER", { name: "Pan", role: "admin" }], ["pFAKE", { name: "Pan ⠀⠀⠀⠀", role: "coAdmin" }], ["pSCAM", { name: "小美", role: "coAdmin" }], ["pZW", { name: "Pan\u200b", role: "coAdmin" }]];
  assert.deepEqual(safeMentionTargets(admins, { excludeIds: ["pSCAM"] }).map(([id]) => id), ["pOWNER"]);
});
