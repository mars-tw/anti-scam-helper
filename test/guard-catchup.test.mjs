import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Watermarks, selectCatchUp } from "../guard/catchup.mjs";

const now = 1_800_000_000_000;
const msg = (id, minutesAgo, extra = {}) => ({ messageId: id, channelId: "c1", senderId: "u1", createdAt: now - minutesAgo * 60_000, contentType: "NONE", text: "x", ...extra });

test("沒有水位：只建立基準，不補掃", () => {
  const result = selectCatchUp([msg("a", 5), msg("b", 1)], { watermark: undefined, now, maxAgeMs: 30 * 60_000 });
  assert.deepEqual(result.toScan, []);
  assert.equal(result.watermark, now - 60_000);
});

test("補掃斷線期間（水位之後、時限內）的訊息，依時間排序", () => {
  const messages = [msg("old", 60), msg("seen", 20), msg("gap2", 2), msg("gap1", 8)];
  const result = selectCatchUp(messages, { watermark: now - 20 * 60_000, now, maxAgeMs: 30 * 60_000 });
  assert.deepEqual(result.toScan.map((m) => m.messageId), ["gap1", "gap2"]);
  assert.equal(result.watermark, now - 2 * 60_000);
});

test("超過時限、已處理、收回、系統事件、自己的訊息都不補掃", () => {
  const messages = [msg("tooOld", 45), msg("handled", 5), msg("unsent", 4, { unsent: true }), msg("event", 3, { contentType: "CHATEVENT" }), msg("mine", 2, { senderId: "me" }), msg("ok", 1)];
  const result = selectCatchUp(messages, { watermark: now - 60 * 60_000, now, maxAgeMs: 30 * 60_000, handled: new Set(["handled"]), isSelf: (m) => m.senderId === "me" });
  assert.deepEqual(result.toScan.map((m) => m.messageId), ["ok"]);
});

test("水位只往前推並存成 600 權限的檔案", () => {
  const file = join(mkdtempSync(join(tmpdir(), "wm-")), "wm.json");
  const marks = new Watermarks(file, { saveDelayMs: 1 });
  marks.bump("c1", 100);
  marks.bump("c1", 50);
  assert.equal(marks.get("c1"), 100);
  marks.save();
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { c1: 100 });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(new Watermarks(file).get("c1"), 100);
});

test("主機暫停 1 小時以上：6 小時上限內，水位之後的訊息全部補掃", () => {
  const messages = [msg("before", 130), msg("gap-early", 110), msg("gap-mid", 70), msg("gap-late", 40), msg("after", 1)];
  const result = selectCatchUp(messages, { watermark: now - 120 * 60_000, now, maxAgeMs: 360 * 60_000 });
  assert.deepEqual(result.toScan.map((m) => m.messageId), ["gap-early", "gap-mid", "gap-late", "after"]);
  // 舊的 30 分鐘上限會漏掉大半。
  const old = selectCatchUp(messages, { watermark: now - 120 * 60_000, now, maxAgeMs: 30 * 60_000 });
  assert.deepEqual(old.toScan.map((m) => m.messageId), ["after"]);
});
