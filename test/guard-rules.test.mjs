import assert from "node:assert/strict";
import test from "node:test";
import { makeRuleScorer, normalizeForRules } from "../guard/rules.mjs";

const score = makeRuleScorer();
const member = { senderName: "小明" };

test("空格拆字的假換群公告＋短網址：達踢人門檻（≥6），會送 Meta 覆核", () => {
  const text = "通知 : 本 群 明 天 要 刪 除了\n請 大 家 加 入 新 群\n謝 謝 配 合！\n\n1url.cz/AbCdE\n\n換   群 了，請 各 位 配 合一 下 謝 謝！";
  const result = score(member, text);
  assert.ok(result.score >= 6, JSON.stringify(result));
  assert.ok(result.names.includes("假換群公告"));
  assert.ok(result.names.includes("短網址"));
});

test("全形空白與零寬字元也去掉", () => {
  assert.equal(normalizeForRules("換　群\u200b了").compact, "換群了");
  assert.ok(score(member, "本　群　即　將　解　散，請　大　家　加　入　新　群").names.includes("假換群公告"));
});

test("單獨一句「換群了」只到覆核門檻（3），不到踢人分數", () => {
  const result = score(member, "換   群 了，請 各 位 配 合一 下 謝 謝！");
  assert.equal(result.score, 3);
  assert.deepEqual(result.names, ["換群字眼"]);
});

test("一般成員暱稱自稱管理員：有其他訊號時加權", () => {
  const fake = score({ senderName: "管理員小美" }, "換群了，請各位配合");
  assert.ok(fake.names.includes("暱稱自稱管理員"));
  assert.equal(fake.score, 5);
  // 真正的管理員（有 senderRole）不加權；沒有其他訊號也不加權。
  assert.ok(!score({ senderName: "管理員小美", senderRole: "coAdmin" }, "換群了").names.includes("暱稱自稱管理員"));
  assert.equal(score({ senderName: "管理員小美" }, "早安大家").score, 0);
});

test("短網址清單：1url.cz、rb.gy 等都算；網址前緊接英數字不算", () => {
  for (const url of ["1url.cz/x1", "https://rb.gy/abc", "bit.ly/3xyz", "reurl.cc/abc", "tinyurl.com/abc", "lihi3.cc/abc", "s.id/abc"]) {
    assert.ok(score(member, `看這個 ${url}`).names.includes("短網址"), url);
  }
  assert.ok(!score(member, "abc1url.cz/x").names.includes("短網址"));
});

test("沒有 http 的一般網址加 1 分，一般網站（github 等）不加分", () => {
  assert.deepEqual(score(member, "參考 example.xyz/page").names, ["網址"]);
  assert.equal(score(member, "原始碼在 github.com/foo/bar").score, 0);
  assert.equal(score(member, "官網 https://docs.anthropic.com/en/docs").score, 0);
});

test("正常聊天與提醒不誤判", () => {
  for (const text of [
    "我剛加入新群組，請多指教",
    "這群好熱鬧",
    "我把這群的通知關掉了",
    "Claude Code 換成 Opus 之後快很多",
    "有人用過 Codex 嗎",
  ]) {
    assert.equal(score(member, text).score, 0, text);
  }
  // 提醒別人「這是假換群詐騙」：扣分後不到踢人門檻。
  assert.ok(score(member, "大家小心，這種叫大家換群的公告是詐騙嗎？不要點").score < 6);
});

test("既有規則照舊：LINE 邀請、群組搬家", () => {
  assert.ok(score(member, "加我 line: abc123").names.includes("LINE 邀請／加好友"));
  assert.ok(score(member, "請大家移到新群").names.includes("群組搬家"));
});
