import assert from "node:assert/strict";
import test from "node:test";
import { decideAction, findImpersonated, hasScamSignal, shouldScreenLocally, squareKey, visionCounts } from "../guard/policy.mjs";
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
