import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedForLearnOnly, learnOnlyChats, scanNotifyChats } from "../guard/policy.mjs";

test("scanNotify 只認只學習群，刪除與踢人照擋、通知可發", () => {
  const policies = { a: { learnOnly: true, scanNotify: true, allowReply: true }, b: { scanNotify: true }, c: { learnOnly: true } };
  assert.deepEqual([...scanNotifyChats(policies)], ["a"]);
  const lo = learnOnlyChats(policies);
  const send = new Map([["a", {}]]);
  assert.equal(blockedForLearnOnly({ type: "message:send", chatId: "a" }, lo, { sendChats: send }), false);
  for (const type of ["message:delete", "member:remove", "message:unsend", "media:fetch"]) assert.equal(blockedForLearnOnly({ type, chatId: "a" }, lo, { sendChats: send }), true);
});

import { parseAuditImage } from "../guard/policy.mjs";
import { auditText, buildDigestInput, DIGEST_SYSTEM } from "../guard/learn-ext.mjs";

test("parseAuditImage 拆判定、理由、描述；沒具體訊號的 SCAM 降成 SCAM_WEAK", () => {
  const a = parseAuditImage("OK\n終端機畫面\n描述：程式畫面\n技術重點：- systemd");
  assert.equal(a.verdict, "OK"); assert.equal(a.reason, "終端機畫面"); assert.match(a.desc, /描述：程式畫面/);
  assert.equal(parseAuditImage("SCAM\n模型價格頁").verdict, "SCAM_WEAK");
  assert.equal(parseAuditImage("SCAM\n有 QR code 要加 LINE 投資").verdict, "SCAM");
  assert.equal(parseAuditImage("").verdict, undefined);
});

test("auditText 去識別化：不留網址、暱稱、帳號", () => {
  const t = auditText({ kind: "link", verdict: "SUSPECT_SCAM", reason: "短網址、加LINE", desc: "小明說 加 line id: abc123 https://bit.ly/xx 賺錢" }, { names: ["小明"] });
  assert.match(t, /^［連結］判定 SUSPECT_SCAM/);
  assert.doesNotMatch(t, /bit\.ly|abc123|小明/);
});

test("學習筆記多一節稽核案例", () => {
  assert.match(DIGEST_SYSTEM, /## 稽核案例/);
  const { text, counts } = buildDigestInput({ messages: [], extItems: [{ kind: "audit", text: "［圖片］判定 VISION_OK" }, { kind: "image", text: "描述：x" }] });
  assert.equal(counts.audits, 1); assert.equal(counts.images, 1);
  assert.match(text, /### 稽核案例（1 則）/);
  assert.doesNotMatch(buildDigestInput({ extItems: [] }).text, /稽核案例/);
});

test("scanNotify 群可抓圖（只限傳入的 mediaChats），刪踢照擋", () => {
  const lo = new Set(["a", "c"]);
  assert.equal(blockedForLearnOnly({ type: "media:fetch", chatId: "a" }, lo, { mediaChats: new Set(["a"]) }), false);
  assert.equal(blockedForLearnOnly({ type: "media:fetch", chatId: "c" }, lo, { mediaChats: new Set(["a"]) }), true);
  assert.equal(blockedForLearnOnly({ type: "member:remove", chatId: "a" }, lo, { mediaChats: new Set(["a"]) }), true);
});
