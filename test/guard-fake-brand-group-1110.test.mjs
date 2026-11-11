// 士軒 11/10 08:51：假旅行社群／假超商群邀請的單元測試（不連網）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeBrandGroupInvite, FAKE_TRAVEL_GROUP, FAKE_STORE_GROUP } from "../guard/fake-brand-group.mjs";

test("旅行社群組邀請連結 → 假旅行社群", () => {
  assert.equal(fakeBrandGroupInvite({ text: "旅行社優惠群 https://line.me/ti/g2/abc" }), FAKE_TRAVEL_GROUP);
});

test("超商會員福利群＋群組邀請連結 → 假超商群", () => {
  assert.equal(fakeBrandGroupInvite({ text: "超商會員福利群 https://line.me/ti/g2/X" }), FAKE_STORE_GROUP);
});

test("「7 - 1 1 會員群」（有空白）＋ OpenChat 連結 → 假超商群", () => {
  assert.equal(fakeBrandGroupInvite({ text: "7 - 1 1 會員群 https://openchat.line.me/xyz" }), FAKE_STORE_GROUP);
});

test("inviteExpanded（短網址導向群組）＋旅遊字眼、無連結 → 假旅行社群", () => {
  assert.equal(fakeBrandGroupInvite({ text: "機票特價 歡迎加入群組", inviteExpanded: true }), FAKE_TRAVEL_GROUP);
});

test("qrInvite＋全家會員群 → 假超商群", () => {
  assert.equal(fakeBrandGroupInvite({ text: "全家會員群", qrInvite: true }), FAKE_STORE_GROUP);
});

test("對抗：旅遊字眼＋一般網址（非群組邀請）→ undefined", () => {
  assert.equal(fakeBrandGroupInvite({ text: "旅行社特價 https://www.example.com/tour" }), undefined);
});

test("一般邀請、沒有品牌字眼 → undefined", () => {
  assert.equal(fakeBrandGroupInvite({ text: "歡迎加入 https://line.me/ti/g2/abc" }), undefined);
});

test("只有超商字眼、沒有邀請 → undefined", () => {
  assert.equal(fakeBrandGroupInvite({ text: "超商會員群 歡迎來聊" }), undefined);
});

test("對抗：line.me.evil.tld/ti/g2/x 不是 LINE 邀請 → undefined", () => {
  assert.equal(fakeBrandGroupInvite({ text: "7-11 群 line.me.evil.tld/ti/g2/x" }), undefined);
});

test("guard.mjs 原始碼：舊冷卻字串已移除、同一則去重與 noKick 已接上、踢人條件未改", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("fake-admin-cooldown"), false);
  assert.equal(src.includes("suspect-cooldown"), false);
  assert.equal(src.includes('reason: "same-message"'), true);
  assert.equal(src.includes("noKick: true"), true);
  assert.equal(src.includes("const kick = !noKick && config.impersonation?.kickWithInvite === true"), true);
  assert.equal(src.includes("qr.kickOnConfirmed === true"), true);
});
