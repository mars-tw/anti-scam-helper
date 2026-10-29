import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deidentifyForAudit,
  halfwidthDigits,
  appendReplyAudit,
  writeReplyAuditIfEnabled,
  purgeReplyAuditFiles,
  chatHash,
  loadOrCreateSalt,
  taipeiDateString,
  taipeiDayStart,
  msUntilNextPurgeHour,
  REPLY_AUDIT_DEFAULTS,
} from "../guard/reply-audit.mjs";

test("預設關閉", () => {
  assert.equal(REPLY_AUDIT_DEFAULTS.enabled, false);
  assert.equal(REPLY_AUDIT_DEFAULTS.maxAgeDays, 7);
});

test("去識別化正例：電話、email、LINE 長 ID、身分證、卡號、@暱稱、網址查詢參數", () => {
  const raw = [
    "打 0912-345-678 或寄 scam@evil.com",
    "LINE mid uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    "另一個 pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2",
    "身分證 A123456789",
    "卡號 1234567890123456",
    "請 @小明 看 https://ex.com/pay?token=secret&uid=9 謝謝",
  ].join(" ");
  const out = deidentifyForAudit(raw);
  for (const bad of [
    "0912", "345-678", "scam@evil.com",
    "uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    "pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2",
    "A123456789", "1234567890123456",
    "小明", "token=secret", "uid=9",
  ]) {
    assert.ok(!out.includes(bad), `仍露出：${bad} → ${out}`);
  }
  assert.match(out, /［電話］/);
  assert.match(out, /［email］/);
  assert.match(out, /［LINE ID］/);
  assert.match(out, /［身分證］/);
  assert.match(out, /［帳號］/);
  assert.match(out, /［暱稱］/);
  assert.match(out, /［參數略］/);
  assert.match(out, /https:\/\/ex\.com\/pay［參數略］/);
  assert.match(out, /謝謝/);
});

test("去識別化反例：一般句子、短數字、無查詢參數的網址應保留", () => {
  const raw = "今天天氣不錯，價格大約 6500 元，看 https://165.npa.gov.tw/help 就好";
  const out = deidentifyForAudit(raw);
  assert.equal(out.includes("今天天氣不錯"), true);
  assert.equal(out.includes("6500"), true);
  assert.equal(out.includes("https://165.npa.gov.tw/help"), true);
  assert.ok(!out.includes("［參數略］"));
  assert.ok(!out.includes("［電話］"));
});

test("對抗：全形數字電話、空格拆開的電話都要遮", () => {
  const full = deidentifyForAudit("請打 ０９１２３４５６７８ 給我");
  assert.ok(!full.includes("0912345678"), full);
  assert.ok(!/[０-９]/.test(full) || !/０９/.test(full), full);
  assert.match(full, /［電話］/);

  const spaced = deidentifyForAudit("電話 09 12 345 678 喔");
  assert.ok(!spaced.includes("09 12"), spaced);
  assert.ok(!spaced.includes("345 678"), spaced);
  assert.match(spaced, /［電話］/);

  const digitSpaced = deidentifyForAudit("打 0 9 1 2 3 4 5 6 7 8 來");
  assert.match(digitSpaced, /［電話］/);
  assert.ok(!/0 9 1 2/.test(digitSpaced), digitSpaced);
});

test("halfwidthDigits 只轉數字", () => {
  assert.equal(halfwidthDigits("ＡＢ０９"), "ＡＢ09");
});

test("關閉時完全不寫檔", () => {
  const dir = mkdtempSync(join(tmpdir(), "reply-audit-off-"));
  assert.equal(REPLY_AUDIT_DEFAULTS.enabled, false);
  const wrote = writeReplyAuditIfEnabled(
    { enabled: false },
    { logDir: dir, chatId: "C1", reply: "有電話 0912345678", question: "問" },
  );
  assert.equal(wrote, null);
  assert.deepEqual(readdirSync(dir), []);
});

test("開啟時寫 jsonl：含 at／chatHash／reply／question，無原始群 ID／暱稱／成員 ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "reply-audit-on-"));
  const salt = loadOrCreateSalt(dir);
  const name = appendReplyAudit({
    logDir: dir,
    chatId: "CsecretChatId999",
    reply: "請打 0912345678 找 @小華",
    question: "我的信箱是 a@b.com 嗎",
    at: "2026-10-29T02:00:00.000Z",
    salt,
  });
  assert.equal(name, "reply-audit-2026-10-29.jsonl"); // 02:00Z = 台北 10:00
  const lines = readFileSync(join(dir, name), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.at, "2026-10-29T02:00:00.000Z");
  assert.equal(row.chatHash, chatHash("CsecretChatId999", salt));
  assert.notEqual(row.chatHash, "CsecretChatId999");
  assert.ok(!JSON.stringify(row).includes("CsecretChatId999"));
  assert.ok(!("senderId" in row));
  assert.ok(!("senderName" in row));
  assert.ok(!("chatId" in row));
  assert.ok(!row.reply.includes("0912345678"));
  assert.ok(!row.reply.includes("小華"));
  assert.ok(!row.question.includes("a@b.com"));
  assert.match(row.reply, /［電話］/);
  assert.match(row.reply, /［暱稱］/);
  assert.match(row.question, /［email］/);
});

test("過期清除：超過 7 天的 reply-audit 檔刪掉，近的保留", () => {
  const dir = mkdtempSync(join(tmpdir(), "reply-audit-purge-"));
  const now = Date.parse("2026-10-29T04:00:00+08:00");
  // 今天、7 天前應留；8 天前應刪
  writeFileSync(join(dir, "reply-audit-2026-10-29.jsonl"), "{}\n");
  writeFileSync(join(dir, "reply-audit-2026-10-22.jsonl"), "{}\n"); // 剛好 7 天前，保留
  writeFileSync(join(dir, "reply-audit-2026-10-21.jsonl"), "{}\n"); // 8 天前，刪
  writeFileSync(join(dir, "reply-audit-2026-10-01.jsonl"), "{}\n");
  writeFileSync(join(dir, "guard-2026-10-01.jsonl"), "{}\n"); // 別的 log 不動
  const removed = purgeReplyAuditFiles(dir, { maxAgeDays: 7, now });
  assert.equal(removed, 2);
  const left = new Set(readdirSync(dir));
  assert.ok(left.has("reply-audit-2026-10-29.jsonl"));
  assert.ok(left.has("reply-audit-2026-10-22.jsonl"));
  assert.ok(!left.has("reply-audit-2026-10-21.jsonl"));
  assert.ok(!left.has("reply-audit-2026-10-01.jsonl"));
  assert.ok(left.has("guard-2026-10-01.jsonl"));
});

test("taipeiDateString／msUntilNextPurgeHour 基本行為", () => {
  assert.equal(taipeiDateString(Date.parse("2026-10-28T16:30:00Z")), "2026-10-29");
  assert.equal(taipeiDayStart(Date.parse("2026-10-29T10:00:00+08:00")), Date.parse("2026-10-29T00:00:00+08:00"));
  const ms = msUntilNextPurgeHour(3, Date.parse("2026-10-29T02:00:00+08:00"));
  assert.ok(ms > 0 && ms <= 3_600_000 + 60_000); // 約 1 小時內
  const ms2 = msUntilNextPurgeHour(3, Date.parse("2026-10-29T04:00:00+08:00"));
  assert.ok(ms2 > 20 * 3_600_000); // 已過今天 3 點 → 明天
});
