// 10/30：unresolved 短網址列進日報 jsonl（給 22:00 人工辨識）
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortUrlExpandOutcome, unresolvedShortReportLine } from "../guard/short-url-outcome.mjs";

test("stillShortener → unresolved；report line 有 kind", () => {
  const o = shortUrlExpandOutcome({ expanded: { url: "https://reurl.cc/x" }, stillShortener: true });
  assert.equal(o.result, "unresolved");
  assert.equal(o.rewrite, false);
  const line = unresolvedShortReportLine({
    at: "2026-10-30T00:00:00.000Z", chatId: "c-fake", notePostId: "n1", url: "reurl.cc/xFake", result: o.result,
  });
  const row = JSON.parse(line);
  assert.equal(row.kind, "unresolved-short");
  assert.equal(row.chatId, "c-fake");
  assert.equal(row.notePostId, "n1");
  assert.equal(row.url, "reurl.cc/xFake");
});

test("normal／unreachable 不列日報", () => {
  assert.equal(unresolvedShortReportLine({ result: "normal", url: "x" }), null);
  assert.equal(unresolvedShortReportLine({ result: "unreachable", url: "x" }), null);
  assert.equal(shortUrlExpandOutcome({ expanded: { url: "https://example.com/a" }, stillShortener: false }).result, "normal");
});

test("shopping shopWarn 仍為 true（未回歸）", () => {
  assert.equal(shortUrlExpandOutcome({ expanded: { url: "https://shop.example/x" }, shopping: true }).shopWarn, true);
});

test("guard 訊息路徑與記事本路徑皆呼叫 appendUnresolvedShortReport", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.equal((src.match(/appendUnresolvedShortReport\(/g) || []).length, 3); // 定義 1 + 訊息 1 + 記事本 1 → 定義是 function 名，呼叫 2
  // 定義 + 兩處呼叫
  assert.match(src, /function appendUnresolvedShortReport/);
  assert.match(src, /unresolved-short-urls\.jsonl/);
  assert.match(src, /note-short-url-expanded[\s\S]{0,200}appendUnresolvedShortReport/);
  assert.match(src, /short-url-expanded[\s\S]{0,200}appendUnresolvedShortReport/);
});
