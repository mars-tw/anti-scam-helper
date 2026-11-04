import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BANDAN_LINE_OA,
  bandanLineOaAction,
  firstLineOaUrl,
  hasBandanLure,
  hasLineOaForm,
  isBandanLineOa,
  parseLineOaPage,
} from "../guard/line-oa-bandan.mjs";
import { MINER_KICKABLE, imageNotify, notifyScore, noticeTips } from "../guard/notify-rules.mjs";
import { decideAction } from "../guard/policy.mjs";
import { friendAddOnly } from "../guard/kick-scope.mjs";
import { parseSummaryCommand, clampSummarySince, SUMMARY_DEFAULTS } from "../guard/ai-summary.mjs";

const THREE = [
  { kickMode: "notify", label: "踢人群" },
  { kickMode: "off", label: "非踢人群" },
  { kickMode: "notify", label: "Hao0321 只警告群", warnOnly: true },
];

const SAMPLE_助元 = "助元老師帶單保證獲利 加官方帳號 https://line.me/R/ti/p/@abc123 跟單賺錢";
const OA_QR = "https://line.me/R/ti/p/@daidan01";
const LURE_ONLY = "老師帶單保證獲利，私訊我跟單";
const OA_ONLY = "我們店的官方帳號 https://lin.ee/xyzShop 歡迎加好友看新品";

test("LINE OA 形式：@ID、lin.ee、page.line.me、ti/p/@、官方帳號分享語", () => {
  assert.equal(hasLineOaForm("加 @bandanteacher 跟單"), true);
  assert.equal(hasLineOaForm("https://lin.ee/AbCd12"), true);
  assert.equal(hasLineOaForm("看 page.line.me/something"), true);
  assert.equal(hasLineOaForm("https://line.me/R/ti/p/@hello_01"), true);
  assert.equal(hasLineOaForm("", { qrContent: OA_QR }), true);
  assert.equal(hasLineOaForm("LINE 官方帳號分享卡 @shop01"), true);
  assert.equal(hasLineOaForm("今天天氣好 @someone 吃飯"), false); // 無上下文的 @
  assert.equal(hasLineOaForm("https://line.me/ti/g2/xxxx"), false); // 群組邀請不算 OA
});

test("帶單語意＋OA 才命中；單邊不命中", () => {
  assert.equal(isBandanLineOa(SAMPLE_助元), true);
  assert.equal(isBandanLineOa(LURE_ONLY), false);
  assert.equal(isBandanLineOa(OA_ONLY), false);
  assert.equal(isBandanLineOa("", { qrContent: OA_QR, contextText: LURE_ONLY }), true);
  assert.equal(isBandanLineOa("疑似詐騙請小心，不要加 https://lin.ee/x"), false);
  assert.equal(isBandanLineOa(SAMPLE_助元, { protectedSender: true }), false);
});

test("反例：派網／交易所官方、一般商家 LINE@、純投資心得", () => {
  assert.equal(isBandanLineOa("派網官方帳號教學 https://lin.ee/pionex 歡迎註冊"), false);
  assert.equal(isBandanLineOa("Pionex 客服 LINE@：@pionex_official 查帳用"), false);
  assert.equal(isBandanLineOa("店家 LINE@ @myshop168 來買衣服 https://lin.ee/cloth"), false);
  assert.equal(isBandanLineOa("分享一下今天跟單心得，BTC 小賺，沒加任何帳號"), false);
  assert.equal(isBandanLineOa("老師說的波段觀點我覺得有道理"), false); // 無 OA
});

test("正例：各種 OA 形式＋帶單", () => {
  for (const text of [
    "帶單老師 加 @crypto_daidan 保證獲利",
    "跟單名額有限 https://lin.ee/Daidan9 老師帶你賺",
    "分析師一對一跟單 https://page.line.me/daidan",
    "投顧老師帶單 https://line.me/R/ti/p/@daidan_tw 穩賺",
    "LINE 官方帳號 @daidan_ok 招收學員跟單",
  ]) {
    assert.equal(isBandanLineOa(text), true, text);
  }
});

test("處置：三種群永不踢；Hao0321 只警告不刪；踢人／非踢人群可刪", () => {
  assert.equal(MINER_KICKABLE.has(BANDAN_LINE_OA), false);
  for (const g of THREE) {
    const act = bandanLineOaAction({
      warnOnly: Boolean(g.warnOnly),
      deleteMessage: true,
      canDelete: true,
    });
    assert.equal(act.kick, false, g.label);
    if (g.warnOnly) {
      assert.equal(act.delete, false, g.label);
      assert.equal(act.notice, true, g.label);
      assert.equal(act.reason, "warn-only", g.label);
    } else {
      assert.equal(act.delete, true, g.label);
      assert.equal(act.notice, true, g.label);
    }
    // decideAction 不因本規則變成踢人（刪文走獨立 handler，不經 kick）
    assert.notEqual(decideAction({ score: 4, verdict: "SCAM", review: "SCAM", names: [BANDAN_LINE_OA], link: true }), "kick", g.label);
  }
  assert.equal(bandanLineOaAction({ learnOnly: true }).notice, false);
  assert.equal(bandanLineOaAction({ deleteMessage: false, canDelete: true }).delete, false);
  assert.equal(bandanLineOaAction({ deleteMessage: true, canDelete: false }).delete, false);
});

test("帶單＋OA 不會被 friendAddOnly 軟放行", () => {
  assert.equal(friendAddOnly(SAMPLE_助元), false);
  assert.equal(friendAddOnly("加我賴 https://line.me/R/ti/p/@abc"), true); // 無帶單語意才軟放行
});

test("通知層／看圖可列名；提示有說明", () => {
  const ns = notifyScore(SAMPLE_助元, {});
  assert.ok(ns.names.includes(BANDAN_LINE_OA) || ns.notify, ns.names);
  const direct = notifyScore(SAMPLE_助元, {}).names;
  assert.ok(direct.includes(BANDAN_LINE_OA), direct);
  const img = imageNotify("UNSURE", "老師帶單 LINE 官方帳號 QR 保證獲利");
  assert.ok(img.names.includes(BANDAN_LINE_OA), img.names);
  const tips = noticeTips([BANDAN_LINE_OA]);
  assert.ok(tips.some((t) => /帶單|官方帳號|詐騙/.test(t)));
});

test("公開頁解析：認證與好友數；取不到不炸", () => {
  const p = parseLineOaPage('<html><body>認證帳號 好友：128</body></html>');
  assert.equal(p.verified, true);
  assert.equal(p.friends, 128);
  assert.equal(p.lowFriends, true);
  const empty = parseLineOaPage("");
  assert.equal(empty.verified, undefined);
  assert.equal(empty.friends, undefined);
  assert.ok(firstLineOaUrl(SAMPLE_助元).includes("line.me"));
});

test("摘要：預設與上限皆 7 天；兩週／999天／全部都卡 7 天；今天／3天仍可更短", () => {
  assert.equal(SUMMARY_DEFAULTS.maxHistoryDays, 7);
  const NOW = Date.parse("2026-11-04T12:00:00+08:00");
  const all = parseSummaryCommand("/ai整理", NOW);
  assert.equal(all.since, NOW - 7 * 86_400_000);
  assert.match(all.label, /7/);
  assert.equal(parseSummaryCommand("/ai整理 全部", NOW).since, NOW - 7 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 兩週", NOW).since, NOW - 7 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 999天", NOW).since, NOW - 7 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 3天", NOW).since, NOW - 3 * 86_400_000);
  assert.equal(parseSummaryCommand("/ai整理 12小時", NOW).since, NOW - 12 * 3_600_000);
  // 邊界：剛好 7 天內的 since 不往後推；更早的被抬到 floor
  const floor = NOW - 7 * 86_400_000;
  assert.equal(clampSummarySince({ since: floor + 1000 }, NOW), floor + 1000);
  assert.equal(clampSummarySince({ since: floor - 1000 }, NOW), floor);
  assert.equal(clampSummarySince({ label: "全部" }, NOW), floor);
  assert.equal(clampSummarySince(undefined, NOW), floor);
});

test("源碼：guard 有 bandan 處置且不進踢人；摘要入口有 clamp", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /handleBandanLineOa/);
  assert.match(src, /bandan-line-oa-deleted/);
  assert.match(src, /clampSummarySince/);
  assert.match(src, /noteBandanLure/);
  assert.doesNotMatch(src, /BANDAN_LINE_OA.*MINER_KICKABLE|MINER_KICKABLE.*BANDAN_LINE_OA/);
  assert.match(src, /bandanLineOaCfg\.deleteMessage/);
});
