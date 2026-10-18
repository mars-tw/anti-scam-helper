import assert from "node:assert/strict";
import test from "node:test";
import { decideAction, findImpersonated, hasLink, hasScamSignal, buildGuardFacts, ESCALATE_REPLY, labelReply, isFalseModerationClaim, isPromise, MODERATION_REPLY, sanitizeLinks, shouldScreenLocally, squareKey, visionCounts } from "../guard/policy.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const score = makeRuleScorer();

test("兩個模型都判 SCAM＋含連結：至少通知（引用回覆），不踢", () => {
  const { score: s, names } = score({ senderName: "某人" }, "最新優惠在這裡 https://example-shop.xyz/abc 快來看");
  assert.equal(s, 1);
  assert.deepEqual(names, ["網址"]);
  assert.equal(decideAction({ score: s, verdict: "SCAM", review: "SCAM", names }), "notice");
  // 只有 Meta 判 SCAM、地端沒判：維持原規則（不到 notifyScore 就不動作）。
  assert.equal(decideAction({ score: s, verdict: "UNSURE", review: "SCAM", names }), "none");
  // 沒有連結：不因為兩個模型都判 SCAM 就通知。
  assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["私下聯繫"] }), "none");
});

test("原本的處置門檻不變：≥3 分＋Meta SCAM 通知；踢人要 ≥6＋地端 SCAM＋Meta SCAM", () => {
  assert.equal(decideAction({ score: 3, verdict: "UNSURE", review: "SCAM" }), "notice");
  assert.equal(decideAction({ score: 6, verdict: "SCAM", review: "SCAM" }), "kick");
  assert.equal(decideAction({ score: 6, verdict: "UNSURE", review: "SCAM" }), "notice");
  assert.equal(decideAction({ score: 9, verdict: "SCAM", review: "OK" }), "none");
  assert.equal(decideAction({ score: 9, verdict: "SCAM", review: "UNAVAILABLE" }), "none");
});

test("假群組公告（真實案例的變形）仍會踢人等級", () => {
  const r = score({ senderName: "管理員小美" }, "通知 : 本 群 明 天 要 刪 除了\n請 大 家 加 入 新 群\n1url.cz/AbCdE");
  assert.equal(decideAction({ score: r.score, verdict: "SCAM", review: "SCAM", names: r.names }), "kick");
});

test("規則 0 分、沒有訊號的短閒聊不交給地端模型", () => {
  for (const text of ["哈哈哈", "早安", "我也想知道", "這個好用嗎", "Codex 很快", "+1", "笑死"]) {
    assert.equal(shouldScreenLocally({ score: 0, text }), false, text);
  }
});

test("有連結／LINE／金錢字眼、或較長的訊息仍交給地端模型", () => {
  for (const text of ["看這個 abc.xyz/123", "加賴 abc123", "保證獲利快私訊", "有人要一起投資嗎", "x".repeat(41)]) {
    assert.equal(shouldScreenLocally({ score: 0, text }), true, text);
  }
  assert.equal(shouldScreenLocally({ score: 1, text: "嗨" }), true);
  assert.ok(hasScamSignal("https://bit.ly/x"));
});

test("看圖：沒有具體引流／要錢訊號的 SCAM 理由不採計", () => {
  for (const reason of [
    "圖中顯示每週用量上限與重置時間，屬於虛擬貨幣",
    "圖中是某雲端服務的官方停用公告與移轉說明",
    "這張圖片是網站的 robots.txt，說明爬蟲限制",
    "圖中包含雲端主機、模型安裝、虛擬貨幣、刷單、假客服等術語",
    "圖中顯示某 AI 模型的名稱，可能是投資或虛擬貨幣產品",
  ]) assert.equal(visionCounts(reason), false, reason);
  for (const reason of ["圖中有 QR code 與加 LINE 好友的邀請", "老師帶單保證獲利，請加入投資群", "截圖寫著 LINE ID: abc123", "要求匯款到指定帳戶"]) {
    assert.equal(visionCounts(reason), true, reason);
  }
});

test("冒名比對只在同一社群：本人（同 id 或本身是管理員）不算冒名", () => {
  const looksLike = (a, b) => a.includes(b);
  const admins = new Map([["阿明老師", { name: "阿明 老師", ids: new Set(["pA"]) }]]);
  assert.equal(findImpersonated({ nameKey: "阿明老師分身", senderId: "pA", admins, looksLike }), undefined);
  assert.equal(findImpersonated({ nameKey: "阿明老師分身", senderId: "pB", admins, adminIds: new Set(["pB"]), looksLike }), undefined);
  assert.equal(findImpersonated({ nameKey: "阿明老師客服", senderId: "pX", admins, looksLike }), "阿明 老師");
  // 別的社群沒學到這位管理員：不比對。
  assert.equal(findImpersonated({ nameKey: "阿明老師分身", senderId: "pZ", admins: undefined, looksLike }), undefined);
});

test("社群鍵：同社群的不同聊天室相同，不同社群不同", () => {
  assert.equal(squareKey("社群甲 / (新手區) 社群甲"), "社群甲");
  assert.equal(squareKey("社群甲"), "社群甲");
  assert.notEqual(squareKey("工具甲 交流區"), squareKey("工具乙 交流區"));
});

test("含連結＋地端與 Meta 都判 SCAM：本帳號是管理員的群且開關打開 → 刪除（不踢）", () => {
  const base = { score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true };
  assert.equal(decideAction({ ...base, deleteOnLink: true, canDelete: true }), "delete");
  // 無 http 網址、短網址、LINE 邀請也一樣（link 由清掉白名單後的文字判斷）。
  for (const text of ["shop-deal.xyz/abc", "bit.ly/3abc", "https://line.me/ti/g2/AbCdEf", "lin.ee/xyz"]) assert.ok(hasLink(text), text);
  // 分數到 notifyScore 也一樣是刪除，不是只通知；到 strongScore 才踢。
  assert.equal(decideAction({ ...base, score: 4, deleteOnLink: true, canDelete: true }), "delete");
  assert.equal(decideAction({ ...base, score: 6, deleteOnLink: true, canDelete: true }), "kick");
});

test("非管理員的群（刪不了）：只通知", () => {
  assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true, deleteOnLink: true, canDelete: false }), "notice");
});

test("開關關閉（公開版預設）：只通知", () => {
  assert.equal(decideAction({ score: 1, verdict: "SCAM", review: "SCAM", names: ["網址"], link: true, canDelete: true }), "notice");
});

test("白名單／自家群連結：清掉後不算連結，不刪", () => {
  assert.equal(hasLink("新朋友請看置頂 ［本社群官方連結］"), false);
  assert.equal(hasLink("詳見 ［LINE 官方網站］"), false);
  assert.notEqual(decideAction({ score: 0, verdict: "SCAM", review: "SCAM", names: [], link: false, deleteOnLink: true, canDelete: true }), "delete");
});

test("Meta 不可用／不確定／OK：不處置", () => {
  for (const review of [undefined, "UNAVAILABLE", "UNSURE", "OK"]) {
    assert.equal(decideAction({ score: 1, verdict: "SCAM", review, names: ["網址"], link: true, deleteOnLink: true, canDelete: true }), "none", String(review));
  }
});

test("只有 Meta 判 SCAM（地端沒判）或沒有連結：不刪", () => {
  assert.equal(decideAction({ score: 1, verdict: "UNSURE", review: "SCAM", names: ["網址"], link: true, deleteOnLink: true, canDelete: true }), "none");
  assert.equal(decideAction({ score: 2, verdict: "SCAM", review: "SCAM", names: ["私下聯繫"], link: false, deleteOnLink: true, canDelete: true }), "none");
});

const ALLOW = ["line.me/ti/g2/owngroup123", "openchat.line.me/cover/owngroup456", "example-own.org/join"];

test("只有自家群／白名單連結：整則視為官方，略過", () => {
  for (const text of ["新朋友請加入 https://line.me/ti/g2/OwnGroup123?utm=x", "社群入口 openchat.line.me/tw/cover/owngroup456", "報名 https://example-own.org/join/form"]) {
    const r = sanitizeLinks(text, ALLOW);
    assert.equal(r.officialOnly, true, text);
    assert.equal(hasLink(r.text), false, text);
  }
});

test("自家群連結＋外部連結：不算官方，外部連結照常判斷", () => {
  const cases = [
    "官方群 https://line.me/ti/g2/owngroup123 另外看這個 https://scam-site.xyz/promo",
    "官方群 line.me/ti/g2/owngroup123 加這個 line.me/ti/g2/OtherGroup999",
    "入口 openchat.line.me/tw/cover/owngroup456 優惠 bit.ly/3abc",
    "官方群 https://line.me/ti/g2/owngroup123 外部 shop-deal.xyz/abc",
  ];
  for (const text of cases) {
    const r = sanitizeLinks(text, ALLOW);
    assert.equal(r.official, true, text);
    assert.equal(r.officialOnly, false, text);
    assert.equal(hasLink(r.text), true, text);
    assert.ok(r.text.includes("［本社群官方連結］"), text);
  }
  // 外部連結照常計分；兩個模型都判 SCAM → 管理員群刪除、6 分以上踢人。
  const mixed = sanitizeLinks("官方群 https://line.me/ti/g2/owngroup123 外部 https://scam-site.xyz/promo", ALLOW).text;
  const r = score({ senderName: "某人" }, mixed);
  assert.ok(r.names.includes("網址"));
  assert.equal(decideAction({ score: r.score, verdict: "SCAM", review: "SCAM", names: r.names, link: hasLink(mixed), deleteOnLink: true, canDelete: true }), "delete");
  const fake = sanitizeLinks("本群明天要刪除了，請大家加入新群 line.me/ti/g2/OtherGroup999 官方 line.me/ti/g2/owngroup123", ALLOW).text;
  const k = score({ senderName: "某人" }, fake);
  assert.equal(decideAction({ score: k.score, verdict: "SCAM", review: "SCAM", names: k.names, link: hasLink(fake), deleteOnLink: true, canDelete: true }), "kick");
});

test("LINE 官方一般頁面不算外部連結；外部 LINE 邀請算", () => {
  assert.equal(hasLink(sanitizeLinks("說明 https://help.line.me/line/?contentId=1", ALLOW).text), false);
  assert.equal(sanitizeLinks("加這個 https://line.me/ti/g2/OtherGroup999", ALLOW).official, false);
  assert.equal(hasLink(sanitizeLinks("加這個 https://line.me/ti/g2/OtherGroup999", ALLOW).text), true);
});

test("守衛現況：依設定產生，不含設定細節", () => {
  const notify = buildGuardFacts({ kickMode: "notify", deleteOnLink: true, metaAvailable: true, isAdmin: true });
  assert.ok(notify.includes("踢人功能目前暫停，只通知管理員"));
  assert.ok(notify.includes("本帳號在這個群是管理員"));
  assert.ok(notify.includes("先發通知再刪除"));
  assert.ok(notify.includes("聯絡這個群的管理員"));
  assert.ok(notify.includes(ESCALATE_REPLY));
  const kick = buildGuardFacts({ kickMode: "kick", deleteOnLink: true, metaAvailable: false, isAdmin: false });
  assert.ok(kick.includes("可能會把對方移出社群"));
  assert.ok(kick.includes("不是管理員"));
  assert.equal(kick.includes("先發通知再刪除"), false); // Meta 不可用或非管理員：不提刪除
  assert.equal(kick.split("【硬規則】")[0].includes("沒有權限"), false);
  for (const secret of ["strongScore", "muse", "local-vlm", "MODEL_API_KEY", "分以上"]) assert.equal(notify.includes(secret) || kick.includes(secret), false, secret);
});

test("後置過濾：否認或捏造處置事實才換掉", () => {
  assert.ok(isFalseModerationClaim("我這邊沒有踢人", { isAdmin: true }));
  assert.ok(isFalseModerationClaim("我沒有管理員權限啦", { isAdmin: true }));
  assert.ok(isFalseModerationClaim("我不是管理員", { isAdmin: true }));
  assert.ok(isFalseModerationClaim("我是管理員", { isAdmin: false }));
  assert.ok(isFalseModerationClaim("我會把他踢出去", { isAdmin: true, kickMode: "notify" }));
  assert.equal(isFalseModerationClaim("踢人功能目前暫停，只通知管理員", { isAdmin: true, kickMode: "notify" }), false);
  assert.equal(isFalseModerationClaim("本帳號在這個群是管理員，被誤判可以聯絡管理員", { isAdmin: true }), false);
  assert.equal(isFalseModerationClaim("這裡只能通知管理員處理", { isAdmin: false }), false);
  assert.equal(isFalseModerationClaim("用 git branch -d 刪除分支", { isAdmin: true }), false);
});

test("「這個我會轉給本人處理」是唯一允許的承諾句", () => {
  assert.equal(isPromise("這個我會轉給本人處理"), false);
  assert.ok(isPromise("這個我會轉給本人處理，我再幫你邀回來"));
  assert.equal(MODERATION_REPLY, "這要等本人回覆");
});

test("自動回覆：替本人承諾未來行動的句子會被擋", () => {
  for (const answer of ["我再把規則調鬆一點，辛苦你重新進來了", "我會幫你處理", "下次我會注意", "我保證不會再發生", "我晚點匯給你", "改天我們約吃飯", "交給我", "我幫你問問看", "我來改設定", "我改一下就好", "我處理好再跟你說", "答應你", "我明天過去"]) {
    assert.ok(isPromise(answer), answer);
  }
});

test("自動回覆：一般建議與說明不擋", () => {
  for (const answer of ["你可以先查證再說", "建議撥打 165 反詐騙專線", "不要匯款給陌生人", "沒有人能保證獲利", "我覺得這個工具不錯", "我會建議先看官方文件", "我來說明一下：這是官方公告", "這要看你的設定", "記得不要點陌生連結", "我也不知道耶", "可以到設定頁調整", "你再試一次看看", "跟家裡長輩約好一個原則，看到要匯款一律先問"]) {
    assert.equal(isPromise(answer), false, answer);
  }
});

test("回覆標記：結尾一個（AI代理），不留「自動回覆」", () => {
  assert.equal(labelReply("這要等本人回覆"), "這要等本人回覆（AI代理）");
  assert.equal(labelReply("好的（自動回覆）"), "好的（AI代理）");
  assert.equal(labelReply("好的 (自動回覆)（AI代理）"), "好的（AI代理）");
  assert.equal(labelReply("這是自動回覆喔"), "這是喔（AI代理）");
});

// ── 閒聊不硬塞防詐、踢人現況要完整 ─────────────────────────────
import { CASUAL_PROMPT, isCasual, kickStatusText, stripEscalateFiller, trimCasual } from "../guard/policy.mjs";

test("閒聊判斷：玩笑、打招呼算；有連結／錢／詐騙／踢人／管理員字眼不算", () => {
  for (const t of ["你的太慢了🤣", "哈哈哈笑死", "@阿軒 早安", "你今天吃什麼", "這也太強了吧"]) assert.equal(isCasual(t), true, t);
  for (const t of ["這是詐騙嗎", "看這個 https://x.y/abc", "你昨晚把某某踢出去", "要不要一起投資", "管理員在嗎", "加賴 abc123", "x".repeat(61), "怎麼刪 git branch"]) assert.equal(isCasual(t), false, t);
  assert.ok(!CASUAL_PROMPT.includes("165 或"));
});

test("閒聊回覆：去掉防詐提醒、踢人封鎖、轉給本人的句子", () => {
  const bad = "哈哈，網路慢真的很煩！不過提醒大家，確認為詐騙將會執行踢除與封鎖。遇到可疑連結請打 165。這個我會轉給本人處理。";
  assert.equal(trimCasual(bad), "哈哈，網路慢真的很煩！");
  assert.equal(trimCasual("確認為詐騙將會執行踢除與封鎖。這個我會轉給本人處理。"), "");
});

test("「轉給本人處理」只能整段，當結尾客套話就拿掉", () => {
  assert.equal(stripEscalateFiller(`可以先重開機看看。${ESCALATE_REPLY}。`), "可以先重開機看看。");
  assert.equal(stripEscalateFiller(`${ESCALATE_REPLY}。`), `${ESCALATE_REPLY}。`);
  assert.equal(stripEscalateFiller("一般回答"), "一般回答");
});

test("踢人現況：一般暫停，但冒名＋邀請／QR 與購物再犯仍會踢（依設定）", () => {
  const flags = { kickMode: "notify", kickWithInvite: true, kickRepeatShop: true };
  const status = kickStatusText(flags);
  assert.ok(status.includes("暫停") && status.includes("冒用管理員名字") && status.includes("QR") && status.includes("30 天內再貼一頁式詐騙購物"), status);
  assert.equal(kickStatusText({ kickMode: "notify" }), "踢人功能目前暫停，只通知管理員。");
  const facts = buildGuardFacts({ ...flags, isAdmin: true, incidents: ["過去誤判：某機器人曾被誤踢，已加進保護名單。"] });
  assert.ok(facts.includes("冒用管理員名字") && facts.includes("過去誤判") && facts.includes("坦白承認"));
  // 只說「踢人暫停」漏掉例外 → 說錯；有提到例外 → 沒問題。
  assert.equal(isFalseModerationClaim("踢人功能目前是暫停中", { isAdmin: true, ...flags }), "kick-status");
  assert.equal(isFalseModerationClaim(status, { isAdmin: true, ...flags }), false);
  assert.equal(isFalseModerationClaim("冒用管理員名字又貼邀請連結的會直接被移出", { isAdmin: true, ...flags }), false);
  assert.equal(isFalseModerationClaim("確認為詐騙將會執行踢除與封鎖", { isAdmin: true, ...flags }), "kick-claim");
  // 沒開例外時，「踢人暫停」是正確的。
  assert.equal(isFalseModerationClaim("踢人功能目前是暫停中", { isAdmin: true, kickMode: "notify" }), false);
});
