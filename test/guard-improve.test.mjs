import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deidentify } from "../guard/chat-training.mjs";
import { cleanText, cleanDescription, LearnExtStore, MIS_MASKED } from "../guard/learn-ext.mjs";
import { replyGuidelines, riskNote, promoNote } from "../guard/policy.mjs";

const WORDS = ["Grid Trading", "API key", "RSI 指標", "Fibonacci 0.618", "linejs 有支援", "Android 設定", "valid input", "Pinia store", "video id 欄位"];
test("一般英文字、技術名詞不會被當成 LINE ID 遮掉", () => {
  for (const w of WORDS) {
    assert.equal(deidentify(w), w, `deidentify: ${w}`);
    assert.equal(cleanText(w), w, `cleanText: ${w}`);
  }
  assert.equal(cleanDescription("技術重點：網格交易（Grid Trading）在區間內掛單"), "技術重點：網格交易（Grid Trading）在區間內掛單");
});
test("真的 LINE ID、@帳號、email、電話、網址照樣遮", () => {
  const cases = ["LINE ID: abc123", "line id abc_88", "ID：scam.helper", "ID scam8888", "加我 id: wxyz9", "我的id 0912abc"];
  for (const c of cases) { const out = deidentify(c); assert.match(out, /［LINE ID］/, c); assert.equal(/abc123|abc_88|scam\.helper|scam8888|wxyz9|0912abc/.test(out), false, c); }
  const out = cleanText("找 @helper_bot 或寫信 a.b@c.com，電話 0912-345-678，網址 https://x.example/y");
  for (const bad of ["helper_bot", "a.b@c.com", "0912", "https://"]) assert.equal(out.includes(bad), false, bad);
  assert.match(cleanText("帳號 abc12345"), /［帳號］/);
});
test("誤遮修正：只認得遮罩緊貼英文字母的；用新文字取代，不從遮罩還原", () => {
  assert.equal(MIS_MASKED.test("網格交易（Gr［LINE ID］）"), true);
  assert.equal(MIS_MASKED.test("請加 ［LINE ID］"), false);
  const dir = mkdtempSync(join(tmpdir(), "repair-"));
  const s = new LearnExtStore(dir, { salt: "x" });
  s.add({ kind: "image", chatId: "mC", messageId: "1", text: "網格交易（Gr［LINE ID］）" });
  s.add({ kind: "image", chatId: "mC", messageId: "2", text: "請加 ［LINE ID］ 領獎" });
  const broken = s.needsRepair();
  assert.equal(broken.length, 1);
  assert.equal(s.replaceText(broken[0].mid, "網格交易（Grid Trading）"), true);
  const again = new LearnExtStore(dir, { salt: "x" });
  assert.deepEqual(again.since("mC").map((x) => x.text), ["網格交易（Grid Trading）", "請加 ［LINE ID］ 領獎"]);
});
test("回覆規則：長度跟著 maxReplyChars，八項改進都在", () => {
  const g = replyGuidelines({ maxChars: 300 });
  assert.match(g, /兩到三句，最多 300 字/);
  for (const key of ["是在問我嗎", "自稱前後一致", "閒聊", "先確認對方用的平台", "簡短帶過", "服務條款", "停損與清算", "推廣內容、未經驗證", "回撤、手續費和清算", "時間和來源", "不要說「我幫你"]) assert.match(g, new RegExp(key), key);
});
test("槓桿／加倉沒提停損 → 補一句；已經提了或不相關就不補", () => {
  assert.match(riskNote("50倍槓桿套牢了要不要加倉", "可以再看看"), /停損/);
  assert.equal(riskNote("要不要加倉", "記得設停損，清算線先算好"), undefined);
  assert.equal(riskNote("今天吃什麼", "吃麵"), undefined);
});
test("收益截圖／邀請碼沒標推廣 → 補一句；已經標了就不補", () => {
  assert.match(promoNote("看我收益截圖 +559%，邀請碼在這", "好厲害"), /推廣內容、未經驗證/);
  assert.equal(promoNote("邀請碼", "這是推廣內容、未經驗證"), undefined);
  assert.equal(promoNote("怎麼部署", "用 systemd"), undefined);
});
