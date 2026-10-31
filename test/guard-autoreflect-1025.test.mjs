import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScamPatterns, learnablePattern } from "../guard/scam-patterns.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "patterns-"));

test("自動反思 10/25：只有連結佔位、沒有話術的訊息不能當 SCAM 範例", () => {
  assert.equal(learnablePattern("［連結：example.com］"), false);
  assert.equal(learnablePattern("  ［連結：example.org，LINE 邀請／加好友連結］ "), false);
  assert.equal(learnablePattern("看看 ［連結：example.com］"), false);
  assert.equal(learnablePattern("通知：本群明天要刪除了請大家加入新群謝謝配合 ［連結：example.com］"), true);
});

test("自動反思 10/25：addConfirmed 拒收只有連結的訊息，有話術的照收", () => {
  const d = dir();
  const p = new ScamPatterns(d);
  assert.equal(p.addConfirmed("［連結：example.com］", "網址"), false);
  assert.equal(existsSync(join(d, "confirmed.jsonl")) ? readFileSync(join(d, "confirmed.jsonl"), "utf8").trim() : "", "");
  assert.equal(p.addConfirmed("通 知 : 本 群 明 天 要 刪 除 了 請 大 家 加 入 新 群 ［連結：example.com］", "假群組連結"), true);
  assert.equal(readFileSync(join(d, "confirmed.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("自動反思 10/25：舊的只有連結紀錄與標 bad 的紀錄不會出現在範例裡", () => {
  const d = dir();
  const lines = [
    { at: "x", label: "", category: "網址", text: "［連結：example.com］" },
    { at: "x", label: "bad", category: "網址", text: "某科技社群今日整理已公開，歡迎閱讀 ［連結：example.net］" },
    { at: "x", label: "", category: "假群組連結", text: "重要通知：此群明天要刪除了請大家加入新的群組謝謝配合 ［連結：example.org］" },
  ];
  writeFileSync(join(d, "confirmed.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(d, "library.json"), JSON.stringify({ examples: [] }));
  const p = new ScamPatterns(d);
  const texts = p.load().filter((i) => i.source === "confirmed").map((i) => i.text);
  assert.deepEqual(texts, [lines[2].text]);
  const shots = p.examples("［連結：example.com］", 3, 0).map((e) => e.text);
  assert.ok(!shots.some((t) => t.startsWith("［連結：")));
});
