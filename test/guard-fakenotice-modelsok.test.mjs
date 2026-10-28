import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeNoticeModelsOk } from "../guard/notify-rules.mjs";
import { makeRuleScorer, forcedScamNames } from "../guard/rules.mjs";

// 10/28 誤通知（去識別化）：一般成員文字只命中「假群組公告」、沒有連結，第一層與覆核都判 OK，卻仍被強制通知。
const base = { forced: true, link: false, names: ["假群組公告"], verdict: "OK", review: "OK" };
const TEXT = "之前那個群後來搬到新群了，大家自己看狀況，我只是轉述一下聽到的消息而已";

test("規則確實會命中假群組公告（重現原因）", () => {
  const score = makeRuleScorer();
  const { names } = score({ senderName: "一般成員" }, TEXT);
  assert.deepEqual(forcedScamNames(names), ["假群組公告"]);
});

test("只有假群組公告字樣、無連結無聯絡方式、雙模型 OK → 只記錄", () => {
  assert.equal(fakeNoticeModelsOk(base, TEXT), true);
});

test("任一模型不是 OK（SCAM／UNSURE／不可用）→ 照常通知", () => {
  for (const v of ["SCAM", "UNSURE", "MODEL_UNAVAILABLE", undefined]) {
    assert.equal(fakeNoticeModelsOk({ ...base, verdict: v }, TEXT), false, `verdict ${v}`);
    assert.equal(fakeNoticeModelsOk({ ...base, review: v }, TEXT), false, `review ${v}`);
  }
});

test("對抗：附連結、QR、LINE ID、私訊、搜尋群名、其他聯絡管道 → 不降級", () => {
  const variants = [
    "群組搬家到新群 line.me/ti/g2/abc",
    "群組搬家到新群 https://example.test/x",
    "群組搬家到新群 請掃 QR 進入",
    "群組搬家到新群 掃碼加入",
    "群組搬家到新群 賴ID: abc123",
    "群組搬家到新群 LINE：abc123",
    "群組搬家到新群 加我好友拉你",
    "群組搬家到新群 私訊我拿連結",
    "群組搬家到新群 搜尋群名 XX投資",
    "群組搬家到新群 @abc_123",
    "群組搬家到新群 加TG",
    "群組搬家到新群 微信聯絡",
    "群組搬家到新群 ｌｉｎｅ ｉｄ：abc",
  ];
  for (const t of variants) assert.equal(fakeNoticeModelsOk(base, t), false, t);
  assert.equal(fakeNoticeModelsOk({ ...base, link: true }, TEXT), false, "link true");
});

test("對抗：還有其他強制特徵或自稱管理員／冒名 → 不降級", () => {
  for (const extra of ["群組邀請連結", "催促加入新群", "假群組連結", "疑似短網址", "短網址導向群組邀請", "暱稱自稱管理員", "暱稱冒稱群管", "冒用「某某」", "假管理員搬群話術"]) {
    assert.equal(fakeNoticeModelsOk({ ...base, names: ["假群組公告", extra] }, TEXT), false, extra);
  }
  assert.equal(fakeNoticeModelsOk({ ...base, forced: false }, TEXT), false);
  assert.equal(fakeNoticeModelsOk({ ...base, names: [] }, TEXT), false);
});

test("只用在沒開踢人的群：guard 用 !perChatKickHere 擋住，踢人路徑不變", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("fakeNoticeOk ||"));
  assert.ok(line && line.includes("!perChatKickHere") && line.includes('result.action === "notice"'));
  assert.ok(src.indexOf("const fakeNoticeOk") < src.indexOf("if (result.kick) {\n      remove(ws, message, entry);"));
});
