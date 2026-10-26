// 10/26 踢人範圍改版（22:59／23:01／23:02／23:07／23:15）：純函式測試。全部是假 ID、假網域。
import { test } from "node:test";
import assert from "node:assert/strict";
import { unrecognizedReport, classifyFetch, friendAddOnly, FRIEND_NOTE, kickCategory, kickScopeDecision, KICK_FAKE_GROUP, KICK_FAKE_LUXURY, KICK_FAKE_PORN_PDF, KICK_SCAM_GROUP, makeFriendNoteGate, plainInfoShare, unrecognizedLinkAction, UNRECOGNIZED_REPLY } from "../guard/kick-scope.mjs";
import { scanFile } from "../guard/file-scan.mjs";
import { makePdf } from "./fake-pdf.mjs";

const SCAM = { verdict: "SCAM", review: "SCAM" };
const G = "https://line.me/ti/g2/FakeGroup0001";

test("(a) 換群／新群／二群＋群組連結 → 踢；只有換群字眼沒有群組連結 → 不踢", () => {
  assert.equal(kickCategory({ text: `本群要解散了，請大家加入新群 ${G}` }), KICK_FAKE_GROUP);
  assert.equal(kickCategory({ text: "二群在這 https://line.me/ti/g/AbCdEf" }), KICK_FAKE_GROUP);
  assert.equal(kickCategory({ text: "官方備用群 https://openchat.line.me/tw/cover/xyz" }), KICK_FAKE_GROUP);
  assert.equal(kickCategory({ text: "本群要解散了，請大家加入新群 https://scam-site.example/join", ...SCAM }), undefined);
  assert.equal(kickCategory({ text: "本群要解散了，請大家加入新群", ...SCAM }), undefined);
});
test("(a) QR：換群文字＋群組 QR → 踢；冒用群主＋外部群組 QR → 踢；冒用群主＋加好友 QR → 不踢", () => {
  assert.equal(kickCategory({ text: "", qrContent: G, impersonating: "群主" }), KICK_FAKE_GROUP);
  assert.equal(kickCategory({ text: "", qrContent: "https://line.me/ti/p/FakeFriend", impersonating: "群主" }), undefined);
  assert.equal(kickCategory({ text: "", qrContent: G, review: "SCAM" }), KICK_SCAM_GROUP);
  assert.equal(kickCategory({ text: "", qrContent: G, review: "OK" }), undefined);
});
test("(a) 對抗：引用詐騙訊息來提醒大家 → 不踢", () => {
  assert.equal(kickCategory({ text: `大家小心，這是詐騙！不要加入 ${G} 說要換新群的都是假的`, ...SCAM }), undefined);
  assert.equal(kickCategory({ text: `這個新群 ${G} 是詐騙嗎？` }), undefined);
});
test("(b) 詐騙群組：群組邀請＋兩層都 SCAM → 踢；只有一層 → 不踢；加好友連結不算群組", () => {
  assert.equal(kickCategory({ text: `飆股討論 ${G}`, ...SCAM }), KICK_SCAM_GROUP);
  assert.equal(kickCategory({ text: `飆股討論 ${G}`, verdict: "SCAM", review: "OK" }), undefined);
  assert.equal(kickCategory({ text: "飆股討論 https://line.me/ti/p/FakeFriend", ...SCAM }), undefined);
  assert.equal(kickCategory({ text: "短網址", inviteExpanded: true, ...SCAM }), KICK_SCAM_GROUP);
});
test("(b) 假精品：高仿／1:1＋連結＋兩層 SCAM → 踢；沒有確認 → 不踢；一般購物 → 不踢", () => {
  assert.equal(kickCategory({ text: "LV 1:1 高仿包 https://fake-bags.example/a", ...SCAM }), KICK_FAKE_LUXURY);
  assert.equal(kickCategory({ text: "LV 1:1 高仿包 https://fake-bags.example/a", verdict: "SCAM", review: "OK" }), undefined);
  assert.equal(kickCategory({ text: "這件衣服很好看 https://shop.example/a", ...SCAM }), undefined);
});
test("(b) 對抗：一頁式購物夾假字眼（換新群、PDF、色情）但沒有群組連結 → 不踢", () => {
  assert.equal(kickCategory({ text: "名牌包特賣，換新群看更多 https://bagsale.example/x", ...SCAM }), undefined);
  assert.equal(kickCategory({ text: "外流私密 PDF 下載 https://dl.example/x.pdf", ...SCAM }), undefined, "假色情 PDF 要以檔案裡的群組 QR／連結判定");
});
test("(b) 假色情 PDF：檔案裡有群組邀請＋色情檔名 → 假色情 PDF；沒有色情字眼 → 詐騙群組", () => {
  assert.equal(kickCategory({ fileName: "外流私密影片.pdf", fileGroupInvite: true }), KICK_FAKE_PORN_PDF);
  assert.equal(kickCategory({ fileName: "投資講義.pdf", fileGroupInvite: true }), KICK_SCAM_GROUP);
  assert.equal(kickCategory({ fileName: "外流私密影片.pdf" }), undefined);
});
test("不踢的情況（舊路徑）：計分 6、假管理員、跨群相同、冒充負責人要匯款、短網址、保證獲利帶單", () => {
  for (const [text, names] of [
    ["請匯款到這個帳戶 我是負責人", ["冒充負責人問帳戶／指定匯款"]],
    ["同一段話", ["CROSS_INVITE"]],
    ["看這 https://reurl.cc/abc", ["已知短網址"]],
    ["保證獲利 招收帶單學員 加我賴：fake", []],
    ["https://line.me/ti/p/FakeFriend 冒充群主私聊", []],
  ]) assert.equal(kickCategory({ text, names, ...SCAM }), undefined, text);
});
test("範圍：排除群（excludeChats）、只學習、只警告（三個只警告群）、受保護成員 → 一律不踢", () => {
  const scope = { excludeChats: ["cExcl", "cWarn1", "cWarn2", "cWarn3"], learnOnly: new Set(["cLearn"]), warnOnly: new Set(["cWarn1", "cWarn2", "cWarn3"]) };
  const text = `請大家加入新群 ${G}`;
  assert.deepEqual(kickScopeDecision({ chatId: "cMain", scope, text }), { kick: true, category: KICK_FAKE_GROUP });
  for (const chatId of ["cExcl", "cLearn", "cWarn1", "cWarn2", "cWarn3"]) assert.equal(kickScopeDecision({ chatId, scope, text }).kick, false, chatId);
  assert.equal(kickScopeDecision({ chatId: "cMain", scope, text, excluded: true }).kick, false);
  assert.equal(kickScopeDecision({ chatId: "cExcl", scope, fileGroupInvite: true }).kick, false);
});

test("23:01 無法辨識：只有 Cloudflare 挑戰頁算；逾時、DNS、一般 403／503 不算", () => {
  assert.equal(classifyFetch({ status: 403, headers: { server: "cloudflare", "cf-mitigated": "challenge" } }), "cf-challenge");
  assert.equal(classifyFetch({ status: 503, headers: { Server: "cloudflare" }, html: "<title>Just a moment...</title>" }), "cf-challenge");
  assert.equal(classifyFetch({ status: 403, headers: { server: "cloudflare" }, html: "<h1>Forbidden</h1>" }), "http-403");
  assert.equal(classifyFetch({ status: 403, headers: { server: "nginx" }, html: "<title>Just a moment...</title>" }), "http-403", "不是 CF 的 403 不算");
  assert.equal(classifyFetch({ status: 503, headers: { server: "nginx" } }), "http-503", "暫時掛掉不算");
  assert.equal(classifyFetch({ error: "TimeoutError: timeout" }), "timeout");
  assert.equal(classifyFetch({ error: "ENOTFOUND" }), "network");
  assert.equal(classifyFetch({ status: 200, headers: { server: "cloudflare" }, html: "<title>Shop</title>" }), "ok", "有 CF 但正常顯示");
});
test("23:01 無法辨識的處置：放行網站、受保護、排除群／只學習／只警告群不刪", () => {
  const scope = { excludeChats: ["cExcl"], learnOnly: new Set(["cLearn"]), warnOnly: new Set(["cWarn1"]) };
  assert.equal(unrecognizedLinkAction({ kind: "cf-challenge", chatId: "cMain", scope }).act, true);
  assert.equal(unrecognizedLinkAction({ kind: "timeout", chatId: "cMain", scope }).act, false);
  assert.equal(unrecognizedLinkAction({ kind: "http-403", chatId: "cMain", scope }).act, false);
  assert.equal(unrecognizedLinkAction({ kind: "cf-challenge", allowed: true, chatId: "cMain", scope }).act, false);
  assert.equal(unrecognizedLinkAction({ kind: "cf-challenge", excluded: true, chatId: "cMain", scope }).act, false);
  for (const chatId of ["cExcl", "cLearn", "cWarn1"]) assert.equal(unrecognizedLinkAction({ kind: "cf-challenge", chatId, scope }).act, false, chatId);
  assert.ok(UNRECOGNIZED_REPLY.includes("無法辨識") && UNRECOGNIZED_REPLY.includes("不提供放在群組") && UNRECOGNIZED_REPLY.endsWith("（AI代理）"));
  assert.ok(!/https?:/.test(UNRECOGNIZED_REPLY));
});

test("23:02 一般投資／新聞分享 → 不評分；夾導流（拉群、保證獲利、帶單）→ 照一般流程", () => {
  assert.equal(plainInfoShare("台積電今天大漲 3%，分享一篇新聞"), true);
  assert.equal(plainInfoShare("美股昨晚收高，比特幣站上新高，大家怎麼看"), true);
  assert.equal(plainInfoShare("分享影片", { benignOnly: false }), false, "有非放行網站的連結不算");
  assert.equal(plainInfoShare("台股飆股明牌，保證獲利，名額有限"), false);
  assert.equal(plainInfoShare("美股心得，想學的進群 跟老師帶單"), false);
  assert.equal(plainInfoShare("我今天吃拉麵"), false, "不是投資／分享主題就照舊");
  assert.equal(plainInfoShare("台股新聞", { ruleNames: ["假投資平台"] }), false);
});
test("23:07 入金：教入金、談入金不評分（投資帶單那條因入金字眼命中也不算）", () => {
  assert.equal(plainInfoShare("教大家怎麼在派網入金，先綁銀行帳戶", { ruleNames: ["投資帶單"] }), true);
  assert.equal(plainInfoShare("入金保證獲利翻倍，跟單老師", { ruleNames: ["投資帶單"] }), false);
});
test("23:07 加好友（個人）→ 只備註；群組邀請不是加好友；夾群組邀請照群組處理", () => {
  for (const t of ["加我賴：fakeid123 交個朋友", "我的 LINE ID: fakeid", "https://line.me/ti/p/FakeFriend 加好友", "有興趣私聊"]) assert.equal(friendAddOnly(t), true, t);
  assert.equal(friendAddOnly("", { qrContent: "https://line.me/ti/p/FakeFriend" }), true);
  assert.equal(friendAddOnly("", { qrContent: G }), false);
  assert.equal(friendAddOnly(`加我賴：fake 也可以進新群 ${G}`), false);
  assert.equal(kickCategory({ text: `加我賴：fake 也可以進新群 ${G}` }), KICK_FAKE_GROUP, "對抗：加好友文字夾群組邀請 → 照群組邀請處理");
  assert.equal(friendAddOnly("加我賴 保證獲利 帶單"), false, "夾帶單保證獲利 → 一般流程（只通知、不踢）");
  assert.ok(FRIEND_NOTE.endsWith("（AI代理）") && !/分|@|詐騙集團/.test(FRIEND_NOTE.replace("防止被詐騙", "")));
});
test("23:07 備註冷卻：同人同群只提醒一次；只學習群不發；只警告群可以發", () => {
  let t = 0;
  const gate = makeFriendNoteGate({ cooldownMs: 1000, now: () => t });
  const learnOnly = new Set(["cLearn"]);
  assert.equal(gate({ chatId: "cA", senderId: "p1", learnOnly }), true);
  assert.equal(gate({ chatId: "cA", senderId: "p1", learnOnly }), false);
  assert.equal(gate({ chatId: "cA", senderId: "p2", learnOnly }), true);
  assert.equal(gate({ chatId: "cWarn1", senderId: "p1", learnOnly }), true);
  assert.equal(gate({ chatId: "cLearn", senderId: "p9", learnOnly }), false);
  t = 2000;
  assert.equal(gate({ chatId: "cA", senderId: "p1", learnOnly }), true);
});

test("23:15 檔案掃描：假 PDF 三種（群組 QR、一般連結、沒有連結）＋壞檔、超大檔不當掉", async () => {
  const qr = await scanFile(await makePdf({ text: "hello", qr: G }));
  assert.deepEqual(qr.qrs, [G]);
  const link = await scanFile(await makePdf({ text: "see https://shop-fake.example/a" }));
  assert.deepEqual(link.urls, ["https://shop-fake.example/a"]);
  assert.equal(link.qrs.length, 0);
  const none = await scanFile(await makePdf({ text: "no links here" }));
  assert.equal(none.urls.length + none.qrs.length, 0);
  const text = await scanFile(await makePdf({ text: `join ${G}` }));
  assert.deepEqual(text.urls, [G]);
  const broken = await scanFile(Buffer.from("%PDF-1.4 garbage ((( endobj"));
  assert.equal(broken.urls.length + broken.qrs.length, 0);
  assert.equal((await scanFile(Buffer.alloc(11 * 1024 * 1024))).error, "TOO_LARGE");
  assert.equal((await scanFile(Buffer.from("MZ not a pdf"))).error, "UNSUPPORTED");
  assert.equal((await scanFile(Buffer.alloc(0))).error, "EMPTY");
  const slow = await scanFile(await makePdf({ text: "x" }), { pdftotext: "sleep-not-a-tool" });
  assert.ok(slow.error, "外部程式不存在 → 回 error，不丟例外");
});

test("23:47 reportChat：有設才私下發連結；沒設、空字串、跟原群相同 → 只寫 log", () => {
  const f = unrecognizedReport({ reportChat: "uOwnerFake", url: "https://blocked.example/x", chatId: "cA" });
  assert.equal(f.type, "message:send"); assert.equal(f.chatId, "uOwnerFake"); assert.ok(f.text.includes("https://blocked.example/x"));
  assert.equal(unrecognizedReport({ url: "https://blocked.example/x", chatId: "cA" }), undefined);
  assert.equal(unrecognizedReport({ reportChat: " ", url: "https://blocked.example/x", chatId: "cA" }), undefined);
  assert.equal(unrecognizedReport({ reportChat: "cA", url: "https://blocked.example/x", chatId: "cA" }), undefined, "不可回報到原群（會把連結放回群組）");
});
test("23:47 假精品確認字眼只認高仿／1:1", () => {
  assert.equal(kickCategory({ text: "Gucci 一比一 https://x.example/a", ...SCAM }), KICK_FAKE_LUXURY);
  assert.equal(kickCategory({ text: "LV 名牌包只要 $399 https://x.example/a", ...SCAM }), undefined);
  assert.equal(kickCategory({ text: "香奈兒 3折出清 https://x.example/a", ...SCAM }), undefined);
});
