import { test } from "node:test";
import assert from "node:assert/strict";
import { visionContradicts, visionVerdict, parseAuditImage } from "../guard/policy.mjs";

const contradict = [
  "圖中顯示「Hello」的紅色手寫字樣，未見任何 QR code、LINE ID、網址或要求匯款",
  "圖片顯示的是電腦螢幕上的程式碼與文件，內容為「Codex」的設定或討論，並未包含任何 QR code",
  "這張圖片是投資相關的技術分析圖，包含K線圖和趨勢線，無任何QR code、LINE ID、網址、要錢",
  "圖片中顯示的是「歷史數據」的交易紀錄，包括「投資額」、「總利潤」，並未包含任何 QR code 或 LINE ID",
];
const real = [
  "圖中有 +35.86% 獲利、邀請碼與「掃碼立即跟單」QR code，屬投資引流。",
  "圖中含可疑短網址 scam-example.test，引誘散戶投資比特幣ETF",
  "沒有網址，但有 QR code 要加 LINE 投資群",
];
test("理由說沒有引流／要錢訊號的 SCAM 降成 UNSURE", () => {
  for (const r of contradict) { assert.equal(visionContradicts(r), true, r); assert.equal(visionVerdict("SCAM", r), "UNSURE", r); }
});
test("真正有引流訊號的 SCAM 不受影響", () => {
  for (const r of real) { assert.equal(visionContradicts(r), false, r); assert.equal(visionVerdict("SCAM", r), "SCAM", r); }
  assert.equal(visionVerdict("OK", contradict[0]), "OK");
  assert.equal(visionVerdict("SCAM", "模型價格頁"), "SCAM_WEAK");
});
test("看圖稽核也套用矛盾檢查", () => {
  assert.equal(parseAuditImage(`SCAM\n${contradict[0]}\n描述：手寫字`).verdict, "UNSURE");
});
