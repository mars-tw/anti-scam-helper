import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lookalikeExchange } from "../guard/redpacket.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";
import {
  decideAction,
  visionMentionsConcreteShort,
  scanNotifyDecision,
} from "../guard/policy.mjs";
import {
  VOTE_APK,
  CAMPAIGN_GIFT,
  FAKE_BILLING_CS,
  notifyScore,
  noticeTips,
  MINER_KICKABLE,
} from "../guard/notify-rules.mjs";
import { fileExtension, unsupportedFileReportLine } from "../guard/file-scan.mjs";
import { sendNotice } from "../guard/notice.mjs";
import { kickModeFor } from "../guard/policy.mjs";

const score = makeRuleScorer();
const THREE = [
  { kickMode: "notify", label: "踢人群" },
  { kickMode: "off", label: "非踢人群" },
  { kickMode: "notify", label: "Hao0321 只警告群", warnOnly: true },
];

test("仿冒交易所：官方國別放行；查無者不放；[o0]kx 標籤開頭；字中間不誤中；punycode", () => {
  for (const url of [
    "https://okx.com/", "https://www.okx.com/zh-hant", "https://app.okx.com/",
    "https://binance.com/", "https://binance.us/", "https://www.binance.us/",
    "https://pionex.com/", "https://pionex.us/", "https://www.pionex.us/",
    "https://www.bybit.com/", "https://bybit.eu/", "https://gate.io/",
  ]) {
    assert.equal(lookalikeExchange(url), false, "official " + url);
    assert.equal(score({}, url).names.includes("仿冒交易所網域"), false, url);
  }
  for (const url of [
    "https://okx.com.evil/", "https://okx.com.evil.xyz/x", "https://okx-xxx.com/",
    "https://okx-gift.com/red", "https://okx.co/join", "https://0kx.com/a",
    "https://www.0kx.com/a", "https://okxfake.com/", "https://okx-login.net/",
    "http://xn--okx-k83c.com/a", "http://xn--okx-cka.com/a",
    "https://pionex.sg/", "https://bybit.nl/", "https://bybitglobal.com/",
    "https://okx.ac/", "https://okx.cab/",
  ]) {
    assert.equal(lookalikeExchange(url), true, "fake " + url);
    assert.equal(score({}, url).names.includes("仿冒交易所網域"), true, url);
  }
  for (const url of [
    "https://cookx.com/", "https://tokx.ai/", "https://rokx.com/",
    "https://stockx.com/", "https://blockx.io/", "https://fakeokx.com/",
  ]) {
    assert.equal(lookalikeExchange(url), false, "mid " + url);
    assert.equal(score({}, url).names.includes("仿冒交易所網域"), false, url);
  }
});

test("仿冒交易所只通知不踢（三種群）", () => {
  const text = "快去領 https://okx-airdrop.com/gift";
  const r = score({}, text);
  assert.ok(r.names.includes("仿冒交易所網域"));
  // 仿冒交易所本身 5 分；不進 MINER_KICKABLE。decideAction 只用該規則 5 分 → notice，不踢。
  assert.equal(MINER_KICKABLE.has("仿冒交易所網域"), false);
  for (const g of THREE) {
    const d = decideAction({
      score: 5, verdict: "SCAM", review: "SCAM", names: ["仿冒交易所網域"], link: true,
    });
    assert.equal(d, "notice", g.label);
    assert.notEqual(d, "kick", g.label);
    assert.notEqual(d, "delete", g.label);
  }
});

test("一般連結分數>0＋雙模型 SCAM → notice（可能詐騙）", () => {
  assert.equal(
    decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true }),
    "notice",
  );
  assert.equal(
    decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["私下聯繫"], link: false }),
    "none",
  );
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /ordinaryLinkScoreKind/);
  assert.match(src, /link-score/);
});

test("scanNotifyDecision：delete／kick／notice 一律記 notify", () => {
  assert.equal(scanNotifyDecision("delete"), "notify");
  assert.equal(scanNotifyDecision("kick"), "notify");
  assert.equal(scanNotifyDecision("notice"), "notify");
  assert.equal(scanNotifyDecision("none"), "none");
  assert.equal(scanNotifyDecision(undefined), "none");
  assert.equal(scanNotifyDecision(""), "none");
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /scanNotifyDecision/);
});

test("看圖理由提具體短網址 → visionMentionsConcreteShort；泛稱不算；guard 必跑覆核", () => {
  assert.equal(visionMentionsConcreteShort("偽造幣安公告加短網址 bit.ly/abc12"), true);
  assert.equal(visionMentionsConcreteShort("有短網址 https://reurl.cc/xxxx"), true);
  assert.equal(visionMentionsConcreteShort("畫面有網址字樣但沒具體短鏈"), false);
  assert.equal(visionMentionsConcreteShort("附外部短網址引流"), false);
  assert.equal(visionMentionsConcreteShort("非官方「Codex Reset」通知，附外部短網址引流"), false);
  assert.equal(visionMentionsConcreteShort("OK 技術訂閱帳單"), false);
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /visionMentionsConcreteShort\(reason\)/);
  assert.match(src, /SCAM_WEAK[\s\S]{0,240}visionMentionsConcreteShort/);
});

test("UNSUPPORTED 檔案記副檔名並可列入日報", () => {
  assert.equal(fileExtension("report.PDF"), "pdf");
  assert.equal(fileExtension("a.b.Xlsx"), "xlsx");
  assert.equal(fileExtension("noext"), "");
  const line = unsupportedFileReportLine({ fileName: "invoice.docx", fileExt: "docx", chatId: "c1" });
  assert.match(line, /docx/);
  assert.match(line, /UNSUPPORTED|unsupported-file/);
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /appendUnsupportedFileReport/);
  assert.match(src, /unsupportedFileReportLine/);
});

test("回覆送失敗改一般訊息時文字帶暱稱並標（AI代理）", async () => {
  const tried = [];
  const send = async (frame) => {
    tried.push(frame);
    if (frame.replyTo) return { type: "error", code: "SEND_FAILED" };
    return { type: "sent" };
  };
  const r = await sendNotice(send, {
    chatId: "C1",
    text: "疑似詐騙，請小心。（AI代理）",
    replyTo: "m1",
    aboutName: "小明",
  });
  assert.equal(r.answer.type, "sent");
  assert.equal(tried.length, 2);
  assert.equal(Boolean(tried[1].replyTo), false);
  assert.match(tried[1].text, /小明/);
  assert.match(tried[1].text, /（AI代理）/);
});

test("情資：投票＋APK 只通知；反例不中；三種群不踢不刪", () => {
  const hit = notifyScore("幫忙投票選網美，請下載 APK 安裝：https://bit.ly/vote99");
  assert.ok(hit.names.includes(VOTE_APK), JSON.stringify(hit));
  assert.equal(
    notifyScore("模特兒票選請到 Google Play 搜尋官方 App https://play.google.com/store/apps/details?id=x").names.includes(VOTE_APK),
    false,
  );
  assert.equal(notifyScore("這是詐騙嗎？幫忙投票要我裝 APK").names.includes(VOTE_APK), false);
  assert.equal(notifyScore("防詐宣導：不要幫忙投票下載不明 APK").names.includes(VOTE_APK), false);
  const tips = noticeTips([VOTE_APK]);
  assert.ok(tips.some((t) => /APK|未知來源/.test(t)));
  for (const g of THREE) {
    const d = decideAction({
      score: 4, verdict: "SCAM", review: "SCAM", names: [VOTE_APK], link: true,
    });
    assert.notEqual(d, "kick", g.label);
    assert.notEqual(d, "delete", g.label);
  }
});

test("情資：競選小物＋驗證只通知；反例不中", () => {
  const hit = notifyScore("免費贈送競選小物，加 LINE 完成實名認證與金流驗證 https://reurl.cc/abc");
  assert.ok(hit.names.includes(CAMPAIGN_GIFT), JSON.stringify(hit));
  assert.equal(notifyScore("討論一下選情與競選小物設計").names.includes(CAMPAIGN_GIFT), false);
  assert.equal(notifyScore("真競選團隊公告：本週六發放文宣").names.includes(CAMPAIGN_GIFT), false);
  assert.equal(notifyScore("防詐轉貼：假競選小物不要做金流驗證").names.includes(CAMPAIGN_GIFT), false);
  assert.equal(notifyScore("送競選小物請加 LINE：@abc").names.includes(CAMPAIGN_GIFT), false);
  for (const g of THREE) {
    const d = decideAction({
      score: 4, verdict: "SCAM", review: "SCAM", names: [CAMPAIGN_GIFT], link: true,
    });
    assert.notEqual(d, "kick", g.label);
  }
});

test("情資：假消費異常／冒名客服只通知；反例不中", () => {
  const hit = notifyScore("您好這邊是小三美日客服，系統顯示消費異常重複扣款，請點連結解除分期 https://lihi.cc/x");
  assert.ok(hit.names.includes(FAKE_BILLING_CS), JSON.stringify(hit));
  assert.equal(notifyScore("防詐宣導：接到消費異常電話請掛斷打官方").names.includes(FAKE_BILLING_CS), false);
  assert.equal(notifyScore("我接到自稱客服說消費異常，是詐騙嗎？").names.includes(FAKE_BILLING_CS), false);
  assert.equal(notifyScore("提醒大家小心消費異常詐騙").names.includes(FAKE_BILLING_CS), false);
  assert.equal(notifyScore("系統顯示消費異常重複扣款請解除分期").names.includes(FAKE_BILLING_CS), false);
  for (const g of THREE) {
    const d = decideAction({
      score: 4, verdict: "SCAM", review: "SCAM", names: [FAKE_BILLING_CS], link: true,
    });
    assert.notEqual(d, "kick", g.label);
    assert.notEqual(d, "delete", g.label);
  }
});

test("kickMode 預設 notify；MINER 不含情資三規則", () => {
  assert.equal(kickModeFor("any-chat", { globalMode: "notify" }), "notify");
  for (const n of [VOTE_APK, CAMPAIGN_GIFT, FAKE_BILLING_CS]) {
    assert.equal(MINER_KICKABLE.has(n), false, n);
  }
});
