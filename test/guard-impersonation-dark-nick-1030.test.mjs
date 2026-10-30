// 10/30 晨會補測：暗稱冒用群主（尾端空白、暱稱寫成 @群主名）要穩定識別；
// 只驗證比對／正規化，不放寬也不加重踢人（尾端一般空白／純 @ 仍無 invisible → 不升級踢）。
import test from "node:test";
import assert from "node:assert/strict";
import { looksLike, containsNameToken } from "../guard/policy.mjs";
import { analyzeName } from "../guard/fakeadmin.mjs";
import { decideImpersonationKick, hasInvisibleChars } from "../guard/impersonation-kick.mjs";
import { canonName } from "../guard/notify-rules.mjs";

// 與 guard.mjs normalizeName 相同（此函式未 export，測試內複寫一份並鎖住行為）。
const normalizeName = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{C}\p{M}\u115F\u1160\u3164\uFFA0]/gu, "");

const OWNER = "群主小明";
const ownerKey = normalizeName(OWNER);
const looks = (a, b) => looksLike(a, b);
const baseKick = {
  adminNames: [OWNER],
  normalizeName,
  looksLike: looks,
  text: "本群明天要刪除，請大家加入新二群 https://line.me/ti/g2/AbCdEfGh",
  ruleNames: ["假群組公告"],
  verdict: "SCAM",
  model: "local-vlm",
  review: "SCAM",
  excluded: false,
};

test("尾端空白（半形／全形／NBSP）正規化後仍 looksLike 同群群主；無 invisible → 不升級踢", () => {
  for (const nick of [OWNER + " ", OWNER + "   ", OWNER + "\u3000", OWNER + "\u00A0"]) {
    const key = normalizeName(nick);
    assert.equal(key, ownerKey, JSON.stringify(nick));
    assert.equal(looksLike(key, ownerKey), true, nick);
    assert.equal(hasInvisibleChars(nick), false, nick);
    assert.equal(analyzeName(nick).signals.some((s) => s.type === "invisible"), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).reason, "no-invisible", nick);
  }
});

test("暱稱寫成 @群主名／全形＠／＠加空白：正規化後仍 looksLike；無 invisible → 不升級踢", () => {
  for (const nick of ["@" + OWNER, "＠" + OWNER, "@ " + OWNER, "＠　" + OWNER, "@" + OWNER + " "]) {
    const key = normalizeName(nick);
    assert.equal(key, ownerKey, nick);
    assert.equal(looksLike(key, ownerKey), true, nick);
    assert.equal(canonName(nick), canonName(OWNER), nick);
    assert.equal(hasInvisibleChars(nick), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).reason, "no-invisible", nick);
  }
});

test("尾端點字空白／零寬／韓文填充字：仍 looksLike，且有 invisible（既有升級路徑，不新增情境）", () => {
  for (const nick of [OWNER + "\u2800", OWNER + "\u200B", OWNER + "\u3164"]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), true, nick);
    assert.equal(hasInvisibleChars(nick), true, nick);
    assert.ok(analyzeName(nick).signals.some((s) => s.type === "invisible"), nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).kick, true, nick);
  }
});

test("對抗：尾端空白或 @ 別人的名字，不命中本群群主", () => {
  for (const nick of ["群主小華 ", "@群主小華", "＠路人甲", "小明 "]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).kick, false, nick);
  }
  // 短截「小明」占原名不到六成且長度 <4 → 不命中（既有 looksLike 門檻）
  assert.equal(containsNameToken(normalizeName("小明"), ownerKey), false);
});

test("對抗：一般成員暱稱碰巧含空白或 @ 開頭但不是群主名 → 不誤判", () => {
  for (const nick of ["@小華玩家", "玩家小華 ", "  路人乙  "]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), false, nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).reason !== "impersonation-fake-group", true, nick);
  }
});
