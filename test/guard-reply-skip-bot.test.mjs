import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { botIdsFromProtected, makeReplySkip, protectedIdList } from "../guard/reply-skip.mjs";

const cfg = {
  protectedIds: ["u-plain-0001", { note: "假機器人A（群友的機器人）", ids: ["u-bot-a-1", "u-bot-a-2"] }, { note: "假成員", id: "u-member-9" }],
  botIds: ["u-bot-extra-7"],
};

test("保護 ID 的 @提問不回（各種格式）", () => {
  const skip = makeReplySkip(cfg);
  for (const id of ["u-plain-0001", "u-bot-a-1", "u-bot-a-2", "u-member-9", "u-bot-extra-7"]) assert.equal(skip(id), true, id);
});

test("暱稱同名但 ID 不同的人照常回（只看 ID）", () => {
  const skip = makeReplySkip(cfg);
  assert.equal(skip("u-impostor-a"), false);
  assert.equal(skip("假機器人A"), false);
  assert.equal(skip(undefined), false);
  assert.equal(skip(""), false);
});

test("空設定不擋任何人", () => {
  const skip = makeReplySkip();
  assert.equal(skip("u-anyone"), false);
  assert.deepEqual(protectedIdList(undefined), []);
});

test("guard.mjs 只在 reply() 入口使用，不碰偵測／通知／刪踢", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const uses = src.split("skipReplyTo(").length - 1;
  assert.equal(uses, 1);
  const at = src.indexOf("skipReplyTo(message.senderId)");
  const fn = src.lastIndexOf("async function reply(ws, message", at);
  assert.ok(fn > 0 && at - fn < 400, "要在 reply() 開頭");
  assert.match(src.slice(at, at + 200), /reply-skip-bot/);
});

test("只有標成機器人的保護 ID 才不回；保護名單裡的真人照常回", () => {
  const skip = makeReplySkip({ botIds: [...botIdsFromProtected(cfg.protectedIds), ...cfg.botIds] });
  for (const id of ["u-bot-a-1", "u-bot-a-2", "u-bot-extra-7"]) assert.equal(skip(id), true, id);
  for (const id of ["u-plain-0001", "u-member-9", "u-impostor-a"]) assert.equal(skip(id), false, id);
});
