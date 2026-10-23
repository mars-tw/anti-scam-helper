// 10/23 誤判：交易群單純提到投資字眼（入金、出金、翻倍、帶單…）＋第一層 UNSURE 不可通知；
// 只有第一層 SCAM，或 UNSURE 且明確招攬（叫人入金、入金就送、保證獲利、招收跟單…）才通知。踢人分數不變。
import { test } from "node:test";
import assert from "node:assert/strict";
import { textNotifyReasons, makeNotifyTracker, investSolicit } from "../guard/notify-rules.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const R = "投資帶單＋第一層非 OK";
const run = (text, verdict) => textNotifyReasons({ text, chatId: "c1", senderId: "u1", result: { verdict, names: ["投資帶單"] }, tracker: makeNotifyTracker() });

test("單純提到入金／出金／翻倍／帶單＋UNSURE：不通知", () => {
  for (const t of ["看起來有入金一點喔", "我今天入金了", "出金好慢", "這波翻倍了", "今天誰帶單", "要入金嗎", "我先入金看看", "主力進場了吧", "內線消息都是假的"]) {
    assert.equal(investSolicit(t), false, t);
    assert.ok(!run(t, "UNSURE").includes(R), t);
  }
});

test("明確叫人入金／招攬＋UNSURE：仍通知", () => {
  for (const t of ["叫你先入金", "請先入金", "大家趕快入金", "入金就送 100U", "帶你入金賺錢", "最低入金 1000U 起", "保證獲利", "穩賺不賠", "招收學員跟單", "私我帶你入金", "跟單群名額有限"]) {
    assert.equal(investSolicit(t), true, t);
    assert.ok(run(t, "UNSURE").includes(R), t);
  }
});

test("第一層判 SCAM：投資字眼照舊通知；OK／不可用不通知", () => {
  assert.ok(run("看起來有入金一點喔", "SCAM").includes(R));
  assert.ok(!run("叫你先入金", "OK").includes(R));
  assert.ok(!run("叫你先入金", "MODEL_UNAVAILABLE").includes(R));
});

test("踢人規則分數不變（入金仍算投資帶單 2 分）", () => {
  const score = makeRuleScorer();
  const r = score({}, "看起來有入金一點喔");
  assert.ok(r.names.includes("投資帶單"));
  assert.equal(r.score, 2);
});
