import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScamPatterns } from "../guard/scam-patterns.mjs";
import { makeRuleScorer } from "../guard/rules.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "patterns-1030-"));
const share = "分享強者我朋友的 3D 遊戲 ［連結：game.example.dev］";

test("自動反思 10/30：標 bad 的誤判紀錄不當範例，幾乎一樣的訊息也不會再被收回 confirmed", () => {
  const d = dir();
  writeFileSync(join(d, "library.json"), JSON.stringify({ examples: [] }));
  writeFileSync(join(d, "confirmed.jsonl"), JSON.stringify({ at: "x", label: "bad", category: "網址", text: share }) + "\n");
  const p = new ScamPatterns(d);
  assert.equal(p.load().filter((i) => i.source === "confirmed").length, 0);
  assert.equal(p.addConfirmed(share, "網址"), false);
  assert.equal(p.addConfirmed("分享強者我朋友的 3D 遊戲 ［連結：game2.example.dev］", "網址"), false);
  assert.equal(readFileSync(join(d, "confirmed.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("自動反思 10/30（對抗）：bad 紀錄只擋幾乎一樣的訊息，換話術的詐騙照常收進範例", () => {
  const d = dir();
  writeFileSync(join(d, "library.json"), JSON.stringify({ examples: [] }));
  writeFileSync(join(d, "confirmed.jsonl"), JSON.stringify({ at: "x", label: "bad", category: "網址", text: share }) + "\n");
  const p = new ScamPatterns(d);
  // 詐騙者借「分享朋友遊戲」開頭，但要人儲值、加 LINE 換群：和 bad 紀錄差很多，照收。
  assert.equal(p.addConfirmed("分享朋友的遊戲，先儲值 500 送點數，再加 LINE 進新群領獎金，名額有限 ［連結：game.example.dev］", "網址"), true);
  assert.equal(p.addConfirmed("通知：本群明天要刪除了請大家加入新二群謝謝配合 ［連結：x.example.org］", "假群組連結"), true);
});

test("自動反思 10/30：內建範例庫有「分享朋友作品」的 OK 範例，相近訊息會帶到它", () => {
  const d = dir();
  const p = new ScamPatterns(d); // 沒有 library.json → 用內建 example
  const ok = p.examples("分享強者我朋友做的 3D 小遊戲，大家玩玩看", 2, 1).filter((e) => e.label === "OK");
  assert.equal(ok.length, 1);
  assert.match(ok[0].text, /朋友自己做的網頁小遊戲/);
  // 範例只影響提示，不改規則分數：假冒分享遊戲＋換群連結的規則分數不受影響。
  const r = makeRuleScorer()({}, "分享朋友的遊戲 大家進入新二群 https://line.me/ti/g2/abcdefg");
  assert.ok(r.score >= 3, JSON.stringify(r));
});
