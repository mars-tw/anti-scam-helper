import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  visionHasLink,
  visionSoloMayNotify,
  visionMentionsConcreteShort,
  kickModeFor,
  warnOnlyChats,
  decideChatKick,
} from "../guard/policy.mjs";
import { makeReplySkip, botIdsFromProtected } from "../guard/reply-skip.mjs";
import { withAgentLabel, NOTICE_LABEL } from "../guard/notice.mjs";

const CODEX = "非官方「Codex Reset」通知，附外部短網址引流";

test("10/31 Codex：泛稱短網址無具體網域 → 不可單模通知；覆核 SCAM 才可", () => {
  assert.equal(visionHasLink(CODEX), false);
  assert.equal(visionMentionsConcreteShort(CODEX), false);
  assert.equal(visionSoloMayNotify({ reason: CODEX, review: undefined }), false);
  assert.equal(visionSoloMayNotify({ reason: CODEX, review: "OK" }), false);
  assert.equal(visionSoloMayNotify({ reason: CODEX, review: "UNSURE" }), false);
  assert.equal(visionSoloMayNotify({ reason: CODEX, review: "SCAM" }), true);
});

test("10/31 Codex 對抗：踢人群／非踢人群／Hao0321 三群門檻相同；踢人條件不動", () => {
  const policies = {
    cKick: {},
    cNotify: {},
    cWarn1: { warnOnly: true },
    cWarn2: { warnOnly: true },
    cWarn3: { warnOnly: true },
  };
  assert.equal(warnOnlyChats(policies).size, 3);
  assert.equal(kickModeFor("cKick", { globalMode: "notify", groupPolicies: policies }), "notify");
  for (const chatId of ["cKick", "cNotify", "cWarn1", "cWarn2", "cWarn3"]) {
    assert.equal(visionSoloMayNotify({ reason: CODEX, review: undefined }), false, chatId);
    assert.equal(visionSoloMayNotify({ reason: CODEX, review: "SCAM" }), true, chatId);
  }
  // 具體短鏈仍可單模通知（不放寬）
  assert.equal(visionHasLink("畫面有 bit.ly/x9k2 引流"), true);
  assert.equal(visionSoloMayNotify({ reason: "畫面有 bit.ly/x9k2 引流", review: undefined }), true);
  // 踢人條件不變
  assert.equal(decideChatKick({ score: 0, verdict: "UNSURE", review: "SCAM", expandedInvite: true, ordinaryMember: true }), "kick");
});

test("10/31 AI寶：機器人 ID 不回；真人照常；出口必有（AI代理）", () => {
  const skip = makeReplySkip({
    botIds: [
      ...botIdsFromProtected([{ note: "假群內機器人 AI寶", ids: ["u-aibao-fake"] }]),
      "u-community-bot",
    ],
  });
  assert.equal(skip("u-aibao-fake"), true);
  assert.equal(skip("u-community-bot"), true);
  assert.equal(skip("u-human-member"), false);
  assert.equal(withAgentLabel("這要等本人回覆"), "這要等本人回覆（AI代理）");
  assert.ok(withAgentLabel("這要等本人回覆").endsWith(NOTICE_LABEL));
  assert.equal(withAgentLabel("已有（AI代理）"), "已有（AI代理）");
});

test("10/31 原始碼：VISION_LINK 不含泛稱短網址；replyOut 強制標記", () => {
  const policy = readFileSync(new URL("../guard/policy.mjs", import.meta.url), "utf8");
  const linkLine = policy.split("\n").find((l) => l.startsWith("const VISION_LINK"));
  assert.ok(linkLine);
  assert.equal(linkLine.includes("短網址"), false);
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("async function replyOut"), src.indexOf("async function reply("));
  assert.match(block, /withAgentLabel/);
  assert.match(block, /reply:\s*out/);
});
