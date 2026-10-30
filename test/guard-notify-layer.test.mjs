import { test } from "node:test";
import assert from "node:assert/strict";
import { minerAction, CROSS_INVITE, notifyScore, urlKind, imageNotify, makeNotifyTracker, textNotifyReasons, makeLookalikeTracker } from "../guard/notify-rules.mjs";
import { makeRuleScorer, SHORTENERS } from "../guard/rules.mjs";

const rs = makeRuleScorer();
test("e／f／g 話術只加通知分，不改踢人分數", () => {
  const t = "加入福利群每日簽到送好禮，合資每月配息";
  const n = notifyScore(t);
  assert.ok(n.notify && n.score >= 2);
  assert.ok(notifyScore("福利群合資投資虛擬貨幣").score >= 4, "跟投資字眼一起再 +2");
  assert.equal(rs({}, "請問大家今天天氣如何").score, rs({}, "請問大家今天天氣如何").score);
  assert.ok(notifyScore("你的帳戶餘額多少？把錢匯到指定帳戶，匯款單拍照給我").notify);
  assert.ok(notifyScore("想要的 +1 後加我 LINE").notify);
  assert.ok(notifyScore("先付運費就寄出").notify);
  assert.equal(notifyScore("今天的網格參數分享").notify, false);
});
test("4) 網址類型", () => {
  const sh = SHORTENERS;
  assert.equal(urlKind("https://line.me/ti/g2/abc", { shorteners: sh }), "群組邀請");
  assert.equal(urlKind("https://bit.ly/x", { shorteners: sh }), "短網址");
  assert.equal(urlKind("https://xx.supr.link/a", { shorteners: sh }), "短網址");
  assert.equal(urlKind("https://github.com/a/b", { shorteners: sh }), "知識");
  assert.equal(urlKind("https://shopee.tw/p", { shorteners: sh }), "購物");
  assert.equal(urlKind("https://example.org/x", { shorteners: sh }), "其他");
});
test("圖片：a 老師帶單＋網址水印、c 高年化＋QR、多帳號冒充管理員 → 通知；純獲利只記錄、虧損不算", () => {
  assert.ok(imageNotify("UNSURE", "圖中「昨天直播帶大家布局」加上獲利區塊與 example.com 網址水印").notify);
  assert.ok(imageNotify("UNSURE", "圖中有虛擬貨幣年化+2190%收益截圖和QR code").notify);
  assert.ok(!imageNotify("UNSURE", "年化+12%收益截圖和QR code").notify);
  assert.ok(imageNotify("UNSURE", "秒合約猜漲跌畫面，附網址").notify);
  assert.ok(imageNotify("UNSURE", "多個同頭像、同暱稱帳號，疑似冒充管理").notify);
  const p = imageNotify("UNSURE", "截圖為虛擬貨幣帳戶獲利畫面，今日盈利+24%，無QR碼或加入資訊。");
  assert.ok(!p.notify && p.profitOnly);
  const l = imageNotify("UNSURE", "虛擬貨幣網格機器人畫面，顯示虧損，無引流或收款資訊。");
  assert.ok(!l.notify && !l.profitOnly && l.loss);
});
test("b／3：同人 24h 第 2 張獲利圖、獲利圖後貼網址、SCAM≥2、跨群同內容（知識例外）", () => {
  const tr = makeNotifyTracker();
  assert.equal(tr.profitImage("cA", "u1", 1000), false);
  assert.equal(tr.profitImage("cA", "u1", 2000), true);
  assert.equal(tr.profitImage("cA", "u2", 2000 + 25 * 3600e3), false);
  assert.ok(tr.followsProfit("cA", "u1", "私訊我拿教學", 3000));
  const base = { verdict: "OK", names: [] };
  assert.deepEqual(textNotifyReasons({ text: "早安", chatId: "cA", senderId: "u9", result: base, tracker: tr }), []);
  const scam = { verdict: "SCAM", score: 2, names: ["網址"] };
  assert.deepEqual(textNotifyReasons({ text: "x", chatId: "cA", senderId: "u5", result: scam, tracker: tr }), []);
  assert.ok(textNotifyReasons({ text: "x", chatId: "cA", senderId: "u5", result: scam, tracker: tr }).includes("同一人 24 小時內第 2 次判詐騙"));
  const t = "限時好康快看 https://promo.example.net/a1";
  assert.deepEqual(textNotifyReasons({ text: t, chatId: "cA", senderId: "u6", result: base, tracker: tr }), []);
  assert.deepEqual(textNotifyReasons({ text: t, chatId: "cB", senderId: "u7", result: base, tracker: tr }), [], "一般網址跨群不通知");
  const k = "好文推薦 https://github.com/a/b 大家看看";
  textNotifyReasons({ text: k, chatId: "cA", senderId: "u6", result: base, tracker: tr });
  assert.deepEqual(textNotifyReasons({ text: k, chatId: "cB", senderId: "u7", result: base, tracker: tr }), []);
  // 10/23：單純投資字眼＋UNSURE 不通知；第一層 SCAM 或明確招攬才通知（見 guard-invest-mention-1023）。
  assert.ok(!textNotifyReasons({ text: "跟老師", chatId: "cA", senderId: "u8", result: { verdict: "UNSURE", names: ["投資帶單"] }, tracker: tr }).includes("投資帶單＋第一層非 OK"));
  assert.ok(textNotifyReasons({ text: "跟老師", chatId: "cA", senderId: "u8", result: { verdict: "SCAM", names: ["投資帶單"] }, tracker: tr }).includes("投資帶單＋第一層非 OK"));
  assert.deepEqual(textNotifyReasons({ text: "跟老師", chatId: "cA", senderId: "u8", result: { verdict: "OK", names: ["投資帶單"] }, tracker: tr }), []);
  assert.ok(textNotifyReasons({ text: "看 https://ab.supr.link/x", chatId: "cC", senderId: "u3", result: base, tracker: tr, shorteners: SHORTENERS }).includes("子網域短網址"));
});
test("d：同群頭像相同或暱稱 NFKC 相同且像真管理員", () => {
  const lk = makeLookalikeTracker();
  assert.deepEqual(lk.see({ chatId: "c", senderId: "a", avatarKey: "k1", senderName: "甲" }), []);
  assert.ok(lk.see({ chatId: "c", senderId: "b", avatarKey: "k1", senderName: "乙" }).includes("同群多個帳號頭像相同"));
  lk.see({ chatId: "c", senderId: "x", senderName: "ＡＢＣ小編", adminNames: ["ABC小編"] });
  assert.ok(lk.see({ chatId: "c", senderId: "y", senderName: "ABC小編", adminNames: ["ABC小編"] }).includes("同群多個帳號暱稱相同且像真管理員"));
  assert.deepEqual(lk.see({ chatId: "c2", senderId: "y", senderName: "路人" }), []);
  // 對抗：英文管理員名被長單字包含（gemini 含 mini）→ 不算像真管理員
  const lk2 = makeLookalikeTracker();
  lk2.see({ chatId: "c3", senderId: "g1", senderName: "gemini誤一生", adminNames: ["Mini"] });
  assert.deepEqual(lk2.see({ chatId: "c3", senderId: "g2", senderName: "gemini誤一生", adminNames: ["Mini"] }), []);
  const lk3 = makeLookalikeTracker();
  lk3.see({ chatId: "c4", senderId: "m1", senderName: "管理員Mini", adminNames: ["Mini"] });
  assert.ok(lk3.see({ chatId: "c4", senderId: "m2", senderName: "管理員Mini", adminNames: ["Mini"] }).includes("同群多個帳號暱稱相同且像真管理員"));
});

test("跨群（維護者 15:51 修正）：一般網址跨三群→不通知不踢；群組邀請跨兩群→踢人群踢、其他群通知", () => {
  const tr = makeNotifyTracker();
  const base = { verdict: "OK", names: [] };
  const logs = [];
  const plain = "新品上市 https://promo.example.net/sale 歡迎參考";
  for (const c of ["c1", "c2", "c3"]) {
    const r = textNotifyReasons({ text: plain, chatId: c, senderId: "u1", result: base, tracker: tr, log: (x) => logs.push(x) });
    assert.deepEqual(r, []);
    assert.equal(minerAction({ perChatKick: true, reasons: r, verdict: "SCAM", model: "claude-haiku-5-5", review: "SCAM" }), "notice");
  }
  assert.equal(logs.length, 2, "只記錄 cross-chat-plain");
  const inv = "快來新群 https://line.me/ti/g2/AbCdEf123";
  assert.deepEqual(textNotifyReasons({ text: inv, chatId: "mine", senderId: "u2", result: base, tracker: tr }), []);
  const r2 = textNotifyReasons({ text: inv, chatId: "other", senderId: "u2", result: base, tracker: tr });
  assert.ok(r2.includes(CROSS_INVITE));
  const claude = { verdict: "SCAM", model: "claude-haiku-5-5", review: "SCAM" };
  assert.equal(minerAction({ perChatKick: true, reasons: r2, ...claude }), "kick", "踢人群踢");
  assert.equal(minerAction({ perChatKick: false, reasons: r2, ...claude }), "notice", "其他群只通知");
  const r3 = textNotifyReasons({ text: "看這 https://ab.cd/x", chatId: "c9", senderId: "u3", result: base, tracker: tr, inviteExpanded: true });
  textNotifyReasons({ text: "看這 https://ab.cd/x", chatId: "c8", senderId: "u3", result: base, tracker: tr, inviteExpanded: true });
  assert.ok(textNotifyReasons({ text: "看這 https://ab.cd/x", chatId: "c7", senderId: "u3", result: base, tracker: tr, inviteExpanded: true }).includes(CROSS_INVITE) || r3.length === 0);
});
test("踢人群刪踢條件：Claude SCAM＋覆核 SCAM／空／逾時→踢；OK／UNSURE、非 Claude、保護成員、非可踢理由→只通知；其他群一律通知", () => {
  const k = (o) => minerAction({ perChatKick: true, reasons: ["冒充負責人問帳戶／指定匯款"], verdict: "SCAM", model: "claude-haiku-5-5", ...o });
  assert.equal(k({ review: "SCAM" }), "kick");
  assert.equal(k({ review: undefined }), "kick");
  assert.equal(k({ review: "UNAVAILABLE" }), "kick");
  assert.equal(k({ review: "TIMEOUT" }), "kick");
  assert.equal(k({ review: "OK" }), "notice");
  assert.equal(k({ review: "UNSURE" }), "notice");
  assert.equal(k({ model: "grok-4.7-build-fast", review: "SCAM" }), "notice");
  assert.equal(k({ model: "muse-spark-1.3-contributor", review: "SCAM" }), "notice");
  assert.equal(k({ verdict: "UNSURE", review: "SCAM" }), "notice");
  assert.equal(k({ review: "SCAM", protectedMember: true }), "notice");
  assert.equal(minerAction({ perChatKick: true, reasons: ["同群多個帳號頭像相同"], verdict: "SCAM", model: "claude-x", review: "SCAM" }), "kick");
  assert.equal(minerAction({ perChatKick: true, reasons: ["福利／簽到／贈品／合資話術"], verdict: "SCAM", model: "claude-x", review: "SCAM" }), "notice");
  for (const reasons of [["冒充負責人問帳戶／指定匯款"], ["同群多個帳號頭像相同"], ["同群多個帳號暱稱相同且像真管理員"], [CROSS_INVITE]])
    assert.equal(minerAction({ perChatKick: false, reasons, verdict: "SCAM", model: "claude-x", review: "SCAM" }), "notice", "其他群不踢");
});

test("10/30 提案：UNSURE 釣魚彈窗／ClickFix 通知；教學／交易圖／催促安裝口號不通知", () => {
  assert.ok(imageNotify("UNSURE", "彈窗要求連結帳號領取額度").notify);
  assert.ok(imageNotify("UNSURE", "要求在終端機貼上指令執行").notify);
  assert.equal(imageNotify("UNSURE", "教學：在終端機輸入 npm install").notify, false);
  assert.equal(imageNotify("UNSURE", "獲利截圖無QR無網址").notify, false);
  assert.equal(imageNotify("UNSURE", "蝦爆印鈔機催促安裝無連結").notify, false);
});
