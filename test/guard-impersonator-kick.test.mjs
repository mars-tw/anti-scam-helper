import { test } from "node:test";
import assert from "node:assert/strict";
import { impersonatorKick, canonName } from "../guard/notify-rules.mjs";

const admins = [{ name: "阿明老師", avatarKey: "AV1" }, { name: "Brandx小幫手", avatarKey: "AV2" }];
const k = (o) => impersonatorKick({ perChatKick: true, admins, ...o });
test("正規化：NFKC＋零寬＋同形字＋符號", () => {
  assert.equal(canonName("Ｂrаndх\u200B小幫手✨"), canonName("Brandx小幫手"));
});
test("真管理員本人不踢（protectedMember／senderRole 由呼叫端擋）", () => {
  assert.equal(k({ senderName: "阿明老師", avatarKey: "AV1", protectedMember: true }).kick, false);
  assert.equal(k({ senderName: "阿明老師", avatarKey: "AV1" }).kick, true, "同名同頭像但不是本人（呼叫端已排除本人）才會到這");
});
test("小華類：只有頭像皇冠（看圖模型判的）、暱稱沒仿冒 → 不踢", () => {
  assert.equal(k({ senderName: "小華", avatarKey: "AVX" }).kick, false);
  assert.equal(k({ senderName: "小華交易日記", avatarKey: "AV9" }).kick, false);
});
test("仿冒暱稱＋同頭像 ID → 踢", () => {
  const r = k({ senderName: "阿明老師", avatarKey: "AV1" });
  assert.ok(r.kick && r.signals.includes("頭像 ID 與真管理員相同"));
});
test("仿冒暱稱＋👑 → 踢；特殊符號／同形字偽裝 → 踢", () => {
  assert.ok(k({ senderName: "👑阿明老師", avatarKey: "AVZ" }).signals.includes("暱稱含皇冠符號"));
  assert.ok(k({ senderName: "Brаndx小幫手", avatarKey: "AVZ" }).kick, "西里爾 о");
  assert.ok(k({ senderName: "阿明\u200B老師", avatarKey: "AVZ" }).kick, "零寬字元");
  assert.equal(k({ senderName: "阿明老師", avatarKey: "AVZ" }).kick, false, "同名但無偽裝訊號（可能同名）不踢，只走通知");
});
test("其他群（沒有 per-chat kick）只通知：一律不踢", () => {
  assert.equal(impersonatorKick({ perChatKick: false, admins, senderName: "👑阿明老師", avatarKey: "AV1" }).kick, false);
});
