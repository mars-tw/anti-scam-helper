import test from "node:test";
import assert from "node:assert/strict";
import { decideImpersonationKick, fakeGroupContent, hasInvisibleChars, looksLikeAntiScamBot } from "../guard/impersonation-kick.mjs";

const normalizeName = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}\p{C}\p{M}\u115F\u1160\u3164\uFFA0]/gu, "");
const looksLike = (a, b) => a.length >= 2 && b.length >= 2 && a === b;
const base = { adminNames: ["Kevin"], normalizeName, looksLike, verdict: "SCAM", model: "local-vlm", review: "SCAM", excluded: false };
const notice = "【公告】本群即將關閉，請大家明日起移到新群，點連結重新加入，明日統一核准";

test("Kevin + U+2800 假群組公告：升級踢", () => {
  const r = decideImpersonationKick({ ...base, senderName: "Kevin ⠀⠀⠀⠀", text: notice, ruleNames: ["假群組公告"] });
  assert.equal(r.kick, true);
  assert.equal(r.victim, "Kevin");
});
test("零寬字元＋二群邀請連結：升級踢", () => {
  assert.equal(decideImpersonationKick({ ...base, senderName: "Kev\u200Bin", text: "二群在這 https://line.me/ti/g2/abc 快加入" }).kick, true);
});
test("反詐機器人引用假群組公告：不踢", () => {
  const text = `⚠️ 反詐提醒：有人發「${notice}」，這是假群組公告，請不要點`;
  const r = decideImpersonationKick({ ...base, senderName: "Kevin ⠀⠀", text, ruleNames: ["假群組公告"] });
  assert.equal(r.kick, false);
  assert.equal(r.reason, "anti-scam-bot-like");
});
test("冒名但內容正常：不踢", () => {
  assert.equal(decideImpersonationKick({ ...base, senderName: "Kevin ⠀⠀", text: "今天大盤好冷", verdict: "OK" }).kick, false);
  assert.equal(decideImpersonationKick({ ...base, senderName: "Kevin ⠀⠀", text: "今天大盤好冷" }).reason, "not-fake-group");
});
test("跨社群同名（本社群管理員不叫 Kevin）：不踢", () => {
  const r = decideImpersonationKick({ ...base, adminNames: ["小美"], senderName: "Kevin ⠀⠀", text: notice, ruleNames: ["假群組公告"] });
  assert.equal(r.reason, "no-same-community-admin");
});
test("沒有隱形字元、真管理員、模型不確定：不踢", () => {
  assert.equal(decideImpersonationKick({ ...base, senderName: "Kevin", text: notice, ruleNames: ["假群組公告"] }).kick, false);
  assert.equal(decideImpersonationKick({ ...base, excluded: true, senderName: "Kevin ⠀", text: notice, ruleNames: ["假群組公告"] }).kick, false);
  assert.equal(decideImpersonationKick({ ...base, review: "UNSURE", senderName: "Kevin ⠀", text: notice, ruleNames: ["假群組公告"] }).kick, false);
  assert.equal(decideImpersonationKick({ ...base, model: undefined, senderName: "Kevin ⠀", text: notice, ruleNames: ["假群組公告"] }).kick, false);
});
test("輔助判斷", () => {
  assert.equal(hasInvisibleChars("Kevin ⠀"), true);
  assert.equal(hasInvisibleChars("Kevin 先生"), false);
  assert.equal(fakeGroupContent("晚上一起吃飯"), false);
  assert.equal(looksLikeAntiScamBot("疑似詐騙，請管理員確認"), true);
});
