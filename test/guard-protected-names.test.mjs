import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeNameGuard, normalizeProtectedName } from "../guard/protected-names.mjs";
import { minerAction, impersonatorKick, MINER_KICKABLE } from "../guard/notify-rules.mjs";
import { decideNoteAction } from "../guard/notes.mjs";

const NAME = "TestBuddy";
const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
const body = (fn) => { const i = src.indexOf(`function ${fn}(`); assert.ok(i >= 0, fn); return src.slice(i, src.indexOf("\n}\n", i)); };

test("名字比對：去頭尾空白、不分大小寫、全形，相似名不算", () => {
  const g = makeNameGuard([NAME]);
  for (const n of ["TestBuddy", "  testbuddy ", "TESTBUDDY", "ＴｅｓｔＢｕｄｄｙ"]) assert.equal(g.isProtectedName(n), true, n);
  for (const n of ["TestBuddy2", "Test Buddy", "", undefined]) assert.equal(g.isProtectedName(n), false, String(n));
  assert.equal(makeNameGuard([]).isProtectedName(""), false);
  assert.equal(normalizeProtectedName(" A "), "a");
});

test("送出前最後一道：受保護名字的訊息擋踢人、刪文、收回，其他照常", () => {
  const g = makeNameGuard([NAME]);
  g.note({ messageId: "m1", senderName: " testbuddy" });
  g.note({ messageId: "m2", senderName: "someone" });
  for (const type of ["member:remove", "message:delete", "message:unsend"]) {
    assert.equal(g.blocks({ type, messageId: "m1" }), true, type);
    assert.equal(g.blocks({ type, messageId: "m2" }), false, type);
  }
  assert.equal(g.blocks({ type: "message:send", messageId: "m1" }), false, "通知照常");
});

test("礦工群自動踢人、冒充管理員踢人、留言板：受保護成員一律不踢不刪", () => {
  assert.equal(minerAction({ perChatKick: true, reasons: [...MINER_KICKABLE], protectedMember: true }), "notice");
  assert.equal(impersonatorKick({ perChatKick: true, protectedMember: true, senderName: "Admin", admins: [{ name: "Admin" }] }).kick, false);
  assert.equal(decideNoteAction({ score: 99, verdict: "SCAM", review: "SCAM", protectedAuthor: true, deleteOnConfirmed: true, canDelete: true, deleteSupported: true }), "none");
});

test("guard.mjs 每條踢人／刪文路徑都接上受保護名字", () => {
  assert.match(src, /makeNameGuard\(config\.protectedNames \?\? \[\]\)/);
  assert.match(body("remove"), /nameGuard\.protects\(message\)/, "一般踢人 remove()");
  assert.match(body("neverKick"), /nameGuard\.protects\(message\)/, "冒名邀請／購物再犯／礦工群／留言板 neverKick");
  assert.match(body("isStaff"), /nameGuard\.protects\(message\)/, "刪連結／詢問者遮蔽 isStaff");
  assert.match(body("fakeAdminExcluded"), /nameGuard\.protects\(message\)/, "冒充管理員踢人");
  assert.match(body("deleteFollowup"), /nameGuard\.protects\(message\)/, "踢後補刪");
  assert.match(body("call"), /nameGuard\.blocks\(frame\)/, "所有刪文請求");
  assert.match(body("sendKick"), /nameGuard\.blocks\(frame\)/, "直接送出的踢人");
  assert.equal((src.match(/ws\.send\(JSON\.stringify\(\{ type: "member:remove"/g) ?? []).length, 0, "不准繞過 sendKick");
  assert.match(src, /protectedMember: neverKick\(message\)/, "礦工群");
  assert.match(src, /!trusted && !neverKick\(message\) && policyOf/, "冒充管理員直接踢");
  assert.match(src, /nameGuard\.note\(message\);\n\s+watermarks\.bump/, "即時訊息登記");
  assert.match(body("processHistory"), /nameGuard\.note\(message\)/, "歷史訊息登記");
});
