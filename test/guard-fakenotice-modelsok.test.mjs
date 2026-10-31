import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeNoticeModelsOk } from "../guard/notify-rules.mjs";
import { makeRuleScorer, forcedScamNames } from "../guard/rules.mjs";
import { decideChatKick } from "../guard/policy.mjs";

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

test("通知略過套用全部守護群（含踢人群）；仍只在 action===notice 時生效", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /const suppressNotice = result\.action === "notice" && \(/);
  assert.match(src, /fakeNoticeOk \|\|/);
  // 踢人群仍可因 fakeNoticeOk 略過通知；knowledgeLink／heuristic／reviewOnly 仍限非踢人群
  const block = src.slice(src.indexOf("const suppressNotice"), src.indexOf("if (suppressNotice)"));
  assert.match(block, /fakeNoticeOk/);
  assert.match(block, /!perChatKickHere && \(knowledgeLink \|\| heuristicOnly \|\| reviewOnlyScam/);
  // 踢人路徑在略過之後、仍以 result.kick 直接 remove，不受 suppress 影響
  const after = src.indexOf("if (suppressNotice)");
  const kickIdx = src.indexOf("if (result.kick) {\n      remove(ws, message, entry);", after);
  assert.ok(kickIdx > after);
});

test("對抗：踢人群假公告只要帶連結／QR／ID → 不略過，維持原通知條件", () => {
  // 模擬踢人群收到「假群組公告＋引流」：略過條件不成立，之後仍可依模型走通知或踢人
  for (const t of [
    "群組搬家到新群 https://invite.example.test/a",
    "請搬到新群 掃 QR 加入",
    "搬到新群 賴ID: sample_id_01",
  ]) {
    assert.equal(fakeNoticeModelsOk({ ...base, verdict: "OK", review: "OK" }, t), false, t);
    assert.equal(fakeNoticeModelsOk({ forced: true, link: true, names: ["假群組公告"], verdict: "OK", review: "OK" }, TEXT), false);
  }
  // 雙模型 OK＋有連結：決定層不會因 fakeNotice 略過而改成 none（呼叫端只在 fakeNoticeOk 時略過）
  assert.equal(fakeNoticeModelsOk({ forced: true, link: false, names: ["假群組公告"], verdict: "SCAM", review: "SCAM" }, "群組搬家到新群 https://invite.example.test/a"), false);
});

test("踢人結果不變：雙模型 SCAM＋分數達門檻仍 kick；略過只動 notice", () => {
  // decideChatKick：SCAM＋分數夠 → kick（與 fakeNotice 略過無關）
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-test", review: "SCAM" }), "kick");
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-test", review: "UNAVAILABLE" }), "kick");
  // 雙模型 OK：decideChatKick 不回 kick（回 undefined → 上層用 notice）
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "OK", model: "claude-test", review: "OK" }), undefined);
  // 有連結的假公告、模型 SCAM：fakeNotice 不略過，kick 路徑可走
  const withLink = "群組搬家到新群 https://invite.example.test/a";
  assert.equal(fakeNoticeModelsOk({ forced: true, link: true, names: ["假群組公告", "網址"], verdict: "SCAM", review: "SCAM" }, withLink), false);
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "SCAM", model: "claude-test", review: "SCAM" }), "kick");
  // 無連結、雙模型 OK：略過通知；但本來也不會 kick
  assert.equal(fakeNoticeModelsOk(base, TEXT), true);
  assert.equal(decideChatKick({ score: 6, strongScore: 6, verdict: "OK", model: "claude-test", review: "OK" }), undefined);
});
