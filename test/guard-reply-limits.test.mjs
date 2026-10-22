import { test } from "node:test";
import assert from "node:assert/strict";
import { makeChatReplyLimiter, DEFAULT_REPLY_LIMITS } from "../guard/policy.mjs";

test("預設上限是每人每分鐘 1 則、每群每分鐘 3 則", () => {
  assert.deepEqual({ ...DEFAULT_REPLY_LIMITS }, { perSenderPerMinute: 1, perChatPerMinute: 3, implicitSenderSeconds: 180 });
});
test("沒有 @ 本帳號就不回", () => {
  const l = makeChatReplyLimiter({}, { now: () => 0 });
  assert.deepEqual(l.allow("c", "a"), { ok: false, reason: "not-mentioned" });
});
test("同一個發話者一分鐘內只回 1 則，過了一分鐘再放行", () => {
  let t = 0; const l = makeChatReplyLimiter({}, { now: () => t });
  assert.equal(l.allow("c", "a", { mentionedSelf: true }).ok, true);
  assert.equal(l.allow("c", "a", { mentionedSelf: true }).reason, "sender-rate");
  t = 60_000; assert.equal(l.allow("c", "a", { mentionedSelf: true }).ok, true);
});
test("整個群一分鐘最多 3 則，各群分開計", () => {
  const l = makeChatReplyLimiter({}, { now: () => 0 });
  for (const s of ["a", "b", "c"]) assert.equal(l.allow("g", s, { mentionedSelf: true }).ok, true);
  assert.equal(l.allow("g", "d", { mentionedSelf: true }).reason, "chat-rate");
  assert.equal(l.allow("h", "d", { mentionedSelf: true }).ok, true);
});
test("被擋下的不佔額度；可用設定改數字", () => {
  let t = 0; const l = makeChatReplyLimiter({ perSenderPerMinute: 2, perChatPerMinute: 2 }, { now: () => t });
  assert.equal(l.allow("g", "a", { mentionedSelf: true }).ok, true);
  assert.equal(l.allow("g", "a", { mentionedSelf: true }).ok, true);
  assert.equal(l.allow("g", "a", { mentionedSelf: true }).reason, "chat-rate");
  t = 30_000; assert.equal(l.allow("g", "b").reason, "not-mentioned");
  t = 60_001; assert.equal(l.allow("g", "b", { mentionedSelf: true }).ok, true);
});

test("botCampChats：只認 learnOnly 且開了 allowReply/allowSummary 的群；攔截器只放行這些群的送訊", async () => {
  const { botCampChats, blockedForLearnOnly } = await import("../guard/policy.mjs");
  const camp = botCampChats({ g1: { learnOnly: true, allowReply: true, allowSummary: true, replyLimits: { perChatPerMinute: 2 } }, g2: { learnOnly: true }, g3: { allowReply: true } });
  assert.deepEqual([...camp.keys()], ["g1"]);
  assert.equal(camp.get("g1").limits.perChatPerMinute, 2);
  const chats = new Set(["g1", "g2"]);
  assert.equal(blockedForLearnOnly({ type: "message:send", chatId: "g1" }, chats, { sendChats: camp }), false);
  assert.equal(blockedForLearnOnly({ type: "message:send", chatId: "g2" }, chats, { sendChats: camp }), true);
  assert.equal(blockedForLearnOnly({ type: "member:remove", chatId: "g1" }, chats, { sendChats: camp }), true);
  assert.equal(blockedForLearnOnly({ type: "message:delete", chatId: "g1" }, chats, { sendChats: camp }), true);
});

test("叫名字／回覆本帳號（implicit）：同一人 180 秒內只算一次；明確 @ 不受這條限制", async () => {
  const { makeChatReplyLimiter } = await import("../guard/policy.mjs");
  let t = 0;
  const limiter = makeChatReplyLimiter({ perSenderPerMinute: 5, perChatPerMinute: 10 }, { now: () => t });
  assert.equal(limiter.allow("g", "b1", { mentionedSelf: true, implicit: true }).ok, true);
  t = 61_000;
  assert.equal(limiter.allow("g", "b1", { mentionedSelf: true, implicit: true }).reason, "implicit-sender-rate");
  assert.equal(limiter.allow("g", "b1", { mentionedSelf: true }).ok, true);
  t = 181_000;
  assert.equal(limiter.allow("g", "b1", { mentionedSelf: true, implicit: true }).ok, true);
});

test("botCampChats：callNames 讀自設定、去空白；沒設就是空陣列", async () => {
  const { botCampChats } = await import("../guard/policy.mjs");
  const camp = botCampChats({ g1: { learnOnly: true, allowReply: true, callNames: [" 小毛球 ", ""] }, g2: { learnOnly: true, allowReply: true } });
  assert.deepEqual(camp.get("g1").callNames, ["小毛球"]);
  assert.deepEqual(camp.get("g2").callNames, []);
});
