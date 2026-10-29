import test from "node:test";
import assert from "node:assert/strict";
import { notifyScore, textNotifyReasons, makeNotifyTracker, MODA_VOTE_CODE, MINER_KICKABLE, noticeTips } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
import { isPlainAntiScamBotAlert } from "../guard/policy.mjs";

const ruleScore = makeRuleScorer();
const scam = { verdict: "SCAM", review: "SCAM" };
const ok = { verdict: "OK", review: "OK" };
const unsure = { verdict: "UNSURE", review: "UNSURE" };
const has = (t, ctx = scam) => notifyScore(t, ctx).names.includes(MODA_VOTE_CODE);
const reasons = (text, result = scam) => textNotifyReasons({ text, chatId: "c1", senderId: "u1", result: { ...result, names: [], score: 0 }, tracker: makeNotifyTracker() });

test("數發部 10/16：投票／領券＋認證碼類字眼 → 只通知", () => {
  for (const t of [
    "幫我家小孩投票，請輸入 LINE 認證碼",
    "免費領折價券，把簡訊驗證碼回傳即可",
    "優惠券領取要先做手機驗證",
    "領券活動請開啟分享畫面方便核對",
    "投票快截止了，驗證碼傳過來",
  ]) {
    assert.ok(has(t), t);
    assert.equal(notifyScore(t, scam).notify, true);
  }
});

test("數發部 10/16：叫人把認證碼提供／回傳／輸入到連結 → 命中", () => {
  for (const t of [
    "請把認證碼輸入到這個連結 https://vote.example.test/a",
    "驗證碼回傳到以下網址即可完成",
    "到頁面輸入簡訊碼後再回來",
  ]) assert.ok(has(t), t);
});

test("數發部 10/16 反例：正常投票／店家優惠、防詐宣導、別的防詐機器人提醒不算", () => {
  for (const t of [
    "大家投票午餐吃什麼",
    "店家這週有優惠券可以領",
    "正常投票不會要 LINE 認證碼，請勿提供",
    "提醒大家：幫忙投票要認證碼的都是詐騙，不要給",
    "不要相信領折價券要你回傳驗證碼的訊息",
    "這是詐騙嗎？投票還要認證碼？",
  ]) assert.equal(has(t, unsure), false, t);

  const bot = "疑似詐騙提醒\n詐騙機率：88%\n訊息ID：12345\n並非事實判定\n手法：投票騙認證碼";
  assert.ok(isPlainAntiScamBotAlert(bot));
  assert.ok(!reasons(bot, unsure).includes(MODA_VOTE_CODE));
});

test("數發部 10/16 對抗：空白、全形、拆字仍命中；假提醒帶連結且模型判 SCAM 仍通知", () => {
  assert.ok(has("幫 我 投 票 ，請 輸 入 認 證 碼"));
  assert.ok(has("領　券　活　動　請　回　傳　驗　證　碼"));
  assert.ok(has("折價券＋手機驗證".normalize("NFKC")));
  assert.ok(has("投 票\n分\n享\n畫\n面"));
  // 全形
  assert.ok(has("請提供認證碼到連結 https://ｘ.example.test/a".normalize("NFKC")));

  const spoof = "防詐提醒：幫忙投票請到此連結輸入認證碼 https://vote.example.test/x";
  assert.ok(has(spoof, scam), "假提醒＋連結、SCAM → 仍通知");
  assert.equal(has(spoof, unsure), false, "同文、非 SCAM → 不當命中缺口");
  assert.equal(has(spoof, ok), false);
});

test("數發部 10/16：白名單／雙模型 OK 不算；不進踢人分數；教學文案正確", () => {
  const t = "幫我投票，請輸入認證碼";
  assert.equal(has(t, { ...scam, protectedSender: true }), false);
  assert.equal(has(t, ok), false);
  assert.equal(MINER_KICKABLE.has(MODA_VOTE_CODE), false);
  assert.equal(ruleScore(t).names?.includes(MODA_VOTE_CODE) ?? false, false);
  const tips = noticeTips([MODA_VOTE_CODE]);
  assert.equal(tips.length, 1);
  assert.match(tips[0], /正常投票或領券不會要 LINE 認證碼，請勿提供/);
  assert.ok(reasons(t, scam).includes(MODA_VOTE_CODE));
});
