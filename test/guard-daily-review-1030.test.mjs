// 10/30 日報五項：QR→評分路徑放行、假投票 OK 閘、視覺標籤收斂、UNSURE 只通知提案（待審）、反例。
import test from "node:test";
import assert from "node:assert/strict";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";
import { lookalikeExchange } from "../guard/redpacket.mjs";
import { urlKind, imageNotify, notifyScore, MINER_KICKABLE, minerAction } from "../guard/notify-rules.mjs";
import { parseVisionLabel, parseAuditImage, visionVerdict, looksLike } from "../guard/policy.mjs";
import { kickScopeDecision, kickCategory } from "../guard/kick-scope.mjs";
import { hasInvisibleChars, decideImpersonationKick } from "../guard/impersonation-kick.mjs";
import { analyzeName } from "../guard/fakeadmin.mjs";

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

// ── 追加：今天新手法案例＋正常反例；punycode 同類；Hao0321 隱形字元冒名（不改踢人條件）──
const normalizeName = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{C}\p{M}\u115F\u1160\u3164\uFFA0]/gu, "");

test("lookalike／仿冒規則：pionex／binance／bybit／okx 有效與無效 ACE 要命中", () => {
  const ruleFakes = [
    "http://xn--pionex-k83c.com/a",
    "http://xn--pionex-cka.com/a",
    "http://xn--binance-k83c.com/a",
    "http://xn--binance-cka.com/a",
    "http://xn--bybit-k83c.com/a",
    "http://xn--bybit-cka.com/a",
    "http://xn--okx-k83c.com/a",
    "http://xn--okx-cka.com/a",
  ];
  for (const url of ruleFakes) {
    assert.equal(lookalikeExchange(url), true, url);
    const r = score({}, url);
    assert.ok(r.names.includes("仿冒交易所網域"), url + " → " + r.names.join(","));
  }
  for (const url of [
    "https://www.pionex.com/",
    "https://share.pionexapp.com/s/x",
    "https://www.binance.com/",
    "https://www.bybit.com/",
    "https://www.okx.com/",
  ]) {
    assert.equal(lookalikeExchange(url), false, url);
    assert.equal(score({}, url).names.includes("仿冒交易所網域"), false, url);
  }
});

test("新手法案例：彈窗釣魚／ClickFix 要通知；催促安裝 App 口號單獨不通知（不計踢分）", () => {
  assert.ok(imageNotify("UNSURE", "螢幕彈窗要求連結帳號才能領取額度獎勵").notify);
  assert.ok(imageNotify("UNSURE", "釣魚視窗叫你綁定帳號領紅包").notify);
  assert.ok(imageNotify("UNSURE", "畫面要求於 PowerShell 貼上這段指令執行").notify);
  assert.ok(imageNotify("UNSURE", "叫你在命令提示字元貼入指令驗證").notify);
  assert.equal(imageNotify("UNSURE", "教學：在終端機執行 node -v 看版本").notify, false);
  assert.equal(imageNotify("UNSURE", "交易所 K 線與網格機器人畫面").notify, false);
  assert.equal(imageNotify("UNSURE", "官方 App 下載頁截圖，推薦安裝").notify, false);
  // 催促安裝／印鈔機口號單獨（無短網址／QR）→ 不通知
  assert.equal(imageNotify("UNSURE", "蝦爆印鈔機…催促安裝，保證獲利").notify, false);
  assert.equal(imageNotify("UNSURE", "快去安裝這個賺錢 App").notify, false);
  assert.ok(!MINER_KICKABLE.has("釣魚彈窗連結帳號領額度"));
  assert.ok(!MINER_KICKABLE.has("ClickFix 終端貼指令"));
});

test("okx：官方與子網域放行；假尾碼／連字／錯 TLD／punycode／0kx 命中仿冒交易所", () => {
  const official = [
    "https://okx.com/",
    "https://www.okx.com/join/ABC",
    "https://www.okx.com/zh-hant/trade-spot/btc-usdt",
    "https://app.okx.com/join/x",
    "https://www.okx.com",
  ];
  for (const url of official) {
    assert.equal(lookalikeExchange(url), false, url);
    assert.equal(score({}, url).names.includes("仿冒交易所網域"), false, url);
  }
  const fakes = [
    "https://okx.com.evil/",
    "https://okx.com.evil.xyz/x",
    "https://okx-xxx.com/",
    "https://okx-gift.com/red",
    "https://okx.co/join",
    "https://fakeokx.com/",
    "https://0kx.com/a",
    "https://www.0kx.com/a",
    "http://xn--okx-k83c.com/a",
    "http://xn--okx-cka.com/a",
  ];
  for (const url of fakes) {
    assert.equal(lookalikeExchange(url), true, "lookalike-" + url);
    const r = score({}, url);
    assert.ok(r.names.includes("仿冒交易所網域"), url + " → " + r.names.join(","));
    assert.ok(r.score >= 5, url);
  }
  assert.ok(!MINER_KICKABLE.has("仿冒交易所網域"));
  // 三種群：仿冒 okx 只通知不踢
  const fakeText = "領空投 https://okx-gift.com/box";
  const fakeNames = score({}, fakeText).names;
  assert.ok(fakeNames.includes("仿冒交易所網域"));
  assert.equal(minerAction({ perChatKick: true, reasons: fakeNames, verdict: "SCAM", model: "claude", review: "SCAM" }), "notice");
  assert.equal(minerAction({ perChatKick: false, reasons: fakeNames, verdict: "SCAM", model: "claude", review: "SCAM" }), "notice");
  for (const chatId of ["cKick", "cOther", "cWarn1", "cWarn2", "cWarn3"]) {
    assert.equal(
      kickScopeDecision({ chatId, scope, text: fakeText, names: fakeNames, verdict: "SCAM", review: "SCAM" }).kick,
      false,
      chatId,
    );
  }
});

test("催促安裝圖：同時帶短網址或 QR 才通知；單獨不通知；三種群只通知不踢", () => {
  const withShort = imageNotify("UNSURE", "蝦爆印鈔機催促安裝，畫面有短網址 reurl.cc/AbCd");
  assert.ok(withShort.notify);
  assert.ok(withShort.names.includes("催促安裝＋短網址或QR"));
  const withQr = imageNotify("UNSURE", "快去安裝這個賺錢 App，附 QR code");
  assert.ok(withQr.notify);
  assert.ok(withQr.names.includes("催促安裝＋短網址或QR"));
  const withBitly = imageNotify("UNSURE", "印鈔機保證獲利催促安裝，浮水印 bit.ly/xx");
  assert.ok(withBitly.notify);
  // 單獨／無短網址無 QR
  assert.equal(imageNotify("UNSURE", "蝦爆印鈔機催促安裝保證獲利，無QR無短網址").notify, false);
  assert.equal(imageNotify("UNSURE", "快去安裝這個 App，畫面無連結").notify, false);
  // 有一般官網網址但無短網址／QR、且口號不算「短網址」→ 不因本規則通知（避免誤傷官方下載頁）
  assert.equal(imageNotify("UNSURE", "催促安裝官方 Pionex App，頁面 pionex.com，無QR無短網址").notify, false);
  assert.ok(!MINER_KICKABLE.has("催促安裝＋短網址或QR"));
  // 三種群：此通知名不在踢人類別 → 踢人／非踢人／Hao0321 只警告皆不踢
  const names = ["催促安裝＋短網址或QR"];
  assert.equal(minerAction({ perChatKick: true, reasons: names, verdict: "UNSURE", model: "local-vlm", review: "UNSURE" }), "notice");
  for (const chatId of ["cKick", "cOther", "cWarn1", "cWarn2", "cWarn3", "cBear", "cLearn"]) {
    assert.equal(
      kickScopeDecision({
        chatId,
        scope,
        text: "（圖片）",
        names,
        verdict: "UNSURE",
        review: "UNSURE",
      }).kick,
      false,
      chatId,
    );
  }
});

test("暱稱加隱形字元冒名 Hao0321：可識別；Hao0321 只警告群不踢；無隱形字元不升級", () => {
  const OWNER = "Hao0321";
  const ownerKey = normalizeName(OWNER);
  const looks = (a, b) => looksLike(a, b);
  const FAKE_INVITE = "本群明天刪除請加新群 https://line.me/ti/g2/AbCdEfGh";
  const baseKick = {
    adminNames: [OWNER],
    normalizeName,
    looksLike: looks,
    text: FAKE_INVITE,
    ruleNames: ["假群組公告"],
    verdict: "SCAM",
    model: "local-vlm",
    review: "SCAM",
    excluded: false,
  };
  // 正例：尾端零寬／點字空白
  for (const nick of [OWNER + "\u200B", OWNER + "\u2800", OWNER + "\u3164"]) {
    assert.equal(looksLike(normalizeName(nick), ownerKey), true, nick);
    assert.equal(hasInvisibleChars(nick), true, nick);
    assert.ok(analyzeName(nick).signals.some((s) => s.type === "invisible"), nick);
    assert.equal(decideImpersonationKick({ ...baseKick, senderName: nick }).kick, true, nick);
  }
  // 反例：真名、尾端普通空白、純 @（無 invisible）不升級踢
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: OWNER }).kick, false);
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: OWNER + " " }).reason, "no-invisible");
  assert.equal(decideImpersonationKick({ ...baseKick, senderName: "@" + OWNER }).reason, "no-invisible");
  // 三種群：隱形冒名＋假群邀請 — 踢人群可踢；Hao0321 只警告三群不踢
  const dark = OWNER + "\u200B";
  assert.equal(
    kickScopeDecision({
      chatId: "cKick",
      scope,
      text: FAKE_INVITE,
      names: ["假群組公告"],
      verdict: "SCAM",
      review: "SCAM",
      senderName: dark,
      adminNames: [OWNER],
    }).kick,
    true,
  );
  for (const chatId of ["cWarn1", "cWarn2", "cWarn3", "cBear", "cLearn"]) {
    assert.equal(
      kickScopeDecision({
        chatId,
        scope,
        text: FAKE_INVITE,
        names: ["假群組公告"],
        verdict: "SCAM",
        review: "SCAM",
        senderName: dark,
        adminNames: [OWNER],
      }).kick,
      false,
      chatId,
    );
  }
});
