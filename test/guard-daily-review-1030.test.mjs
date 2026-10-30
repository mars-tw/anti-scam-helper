// 10/30 日報五項：QR→評分路徑放行、假投票 OK 閘、視覺標籤收斂、UNSURE 只通知提案（待審）、反例。
import test from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { lookalikeExchange } from "../guard/redpacket.mjs";
import { urlKind, imageNotify, notifyScore, MINER_KICKABLE } from "../guard/notify-rules.mjs";
import { parseVisionLabel, parseAuditImage, visionVerdict } from "../guard/policy.mjs";
import { kickScopeDecision, kickCategory } from "../guard/kick-scope.mjs";

const score = makeRuleScorer();
const NOTIFY = 3;

/** 模擬 guard.mjs checkImage：QR 解碼後的網址 → 規則評分 → 是否通知（不踢）。 */
function qrDecodedWouldNotify(content, notifyScore = NOTIFY) {
  const qs = score({ senderName: "" }, content);
  const qk = urlKind(content, { shorteners: SHORTENERS });
  return { wouldNotify: qk !== "知識" && qs.score >= notifyScore, qs, qk };
}

const scope = {
  excludeChats: ["cBear", "cLearnBot"],
  learnOnly: new Set(["cLearn"]),
  warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]),
};

test("1) QR 解碼路徑：share.pionexapp.com 與官方交易所子網域不通知", () => {
  const official = [
    "https://share.pionexapp.com/s/RkbQqHXl?l=en",
    "https://www.pionexapp.com/",
    "https://share.pionex.com/a/wqFpuMBQ",
    "https://www.binance.com/en/activity/referral",
    "https://www.okx.com/join/ABC",
    "https://www.bybit.com/invite",
    "https://accounts.binance.com/en/register",
  ];
  for (const url of official) {
    const r = qrDecodedWouldNotify(url);
    assert.equal(r.wouldNotify, false, url);
    assert.equal(r.qs.score, 0, url);
    assert.equal(lookalikeExchange(url), false, url);
  }
});

test("1) QR 解碼路徑：仿冒交易所仍達通知門檻；三種群不因仿冒升級踢", () => {
  const fake = "https://pionex-app.com/gift";
  const r = qrDecodedWouldNotify(fake);
  assert.equal(r.wouldNotify, true, fake);
  assert.ok(r.qs.names.includes("仿冒交易所網域"));
  assert.ok(!MINER_KICKABLE.has("仿冒交易所網域"));
  const names = r.qs.names;
  for (const chatId of ["cKick", "cOther", "cWarn1"]) {
    assert.equal(
      kickScopeDecision({ chatId, scope, text: fake, names, verdict: "SCAM", review: "SCAM" }).kick,
      false,
      chatId,
    );
  }
  assert.equal(kickCategory({ text: fake, names, verdict: "SCAM", review: "SCAM" }), undefined);
});

test("3) 假投票：模型 OK 且只有非主流網址 → 不通知；有騙認證碼仍通知", () => {
  const VOTE = "假投票／活動騙認證碼";
  const urlOnly = "幫我女兒投一票 https://vote.scam-example.test/a";
  assert.ok(notifyScore(urlOnly).names.includes(VOTE), "無模型時仍命中（保守）");
  assert.ok(!notifyScore(urlOnly, { verdict: "OK" }).names.includes(VOTE), "第一層 OK → 不通知");
  assert.ok(!notifyScore(urlOnly, { verdict: "OK", review: "OK" }).names.includes(VOTE));
  assert.ok(notifyScore(urlOnly, { verdict: "SCAM" }).names.includes(VOTE));
  assert.ok(notifyScore(urlOnly, { verdict: "UNSURE" }).names.includes(VOTE));

  const withCode = "票選活動請輸入手機號碼和 LINE 認證碼";
  assert.ok(notifyScore(withCode, { verdict: "OK" }).names.includes(VOTE), "有騙認證碼：即使 OK 仍通知");
  assert.ok(!notifyScore(withCode, { verdict: "OK", review: "OK" }).names.includes(VOTE), "雙 OK 不通知");
});

test("3) 假投票：正常投票／主流網址仍不觸發", () => {
  const VOTE = "假投票／活動騙認證碼";
  for (const t of ["大家投票午餐吃什麼", "比賽影片 https://youtu.be/abc", "票選 https://b23.tv/x", "投票表單 https://forms.gle/abc"]) {
    assert.ok(!notifyScore(t).names.includes(VOTE), t);
    assert.ok(!notifyScore(t, { verdict: "OK" }).names.includes(VOTE), t);
  }
});

test("4) parseVisionLabel：取最後改口標籤；無改口矛盾 → UNSURE", () => {
  const trading = `UNSURE
不對，應該是 OK：TradingView 股價走勢圖，無引流內容。 等等，我重新確認一下判斷依據，正確的結論如下： OK`;
  const p = parseVisionLabel(trading);
  assert.equal(p.verdict, "OK");
  assert.ok(p.conflict);
  assert.ok(p.labels.includes("UNSURE") && p.labels.includes("OK"));
  assert.equal(visionVerdict(p.verdict, p.reason), "OK");
  assert.equal(parseAuditImage(trading).verdict, "OK");

  const plain = "OK\nTradingView K線圖，無引流";
  assert.equal(parseVisionLabel(plain).verdict, "OK");
  assert.equal(parseVisionLabel(plain).conflict, false);

  const scam = "SCAM\n圖中有加 LINE 投資群 QR";
  assert.equal(parseVisionLabel(scam).verdict, "SCAM");

  // 前後矛盾、沒有「應該是／結論如下」改口句 → UNSURE
  const conflict = "OK\n後面又寫 SCAM 但沒有改口句型";
  // 行首 OK；內文 SCAM 若不成行首標籤則可能只有 OK——刻意用兩行標籤
  const conflict2 = "SCAM\nOK";
  const c2 = parseVisionLabel(conflict2);
  assert.equal(c2.conflict, true);
  assert.equal(c2.verdict, "UNSURE", "無改口句型的矛盾降 UNSURE");
});

test("2) 提案：UNSURE 釣魚彈窗／ClickFix 只通知；反例不通知", () => {
  const popup = imageNotify("UNSURE", "彈窗要求連結帳號以領取額度，畫面像釣魚");
  assert.ok(popup.notify);
  assert.ok(popup.names.includes("釣魚彈窗連結帳號領額度"));

  const clickfix = imageNotify("UNSURE", "畫面要求在終端機貼上指令執行以驗證帳戶");
  assert.ok(clickfix.notify);
  assert.ok(clickfix.names.includes("ClickFix 終端貼指令"));

  // 反例：正常教學貼指令、交易截圖、App 推薦、僅催促安裝口號
  assert.equal(imageNotify("UNSURE", "教學截圖：在終端機輸入 npm install 安裝套件").notify, false);
  assert.equal(imageNotify("UNSURE", "TradingView K線圖與持倉畫面，無引流").notify, false);
  assert.equal(imageNotify("UNSURE", "推薦安裝官方 Pionex App，無 QR 無網址").notify, false);
  assert.equal(imageNotify("UNSURE", "蝦爆印鈔機保證獲利催促安裝，無網址無QR無帳號連結").notify, false);

  // 不計踢分
  assert.ok(!MINER_KICKABLE.has("釣魚彈窗連結帳號領額度"));
  assert.ok(!MINER_KICKABLE.has("ClickFix 終端貼指令"));
});
