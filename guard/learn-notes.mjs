#!/usr/bin/env node
// 讀最新學習筆記（只讀本機檔案，不連 LINE）：node guard/learn-notes.mjs [YYYY-MM-DD | --list | --run-now]
// --run-now：建立觸發檔，守衛在一分鐘內跑一次延伸學習並寫筆記（不在任何群發訊息）。
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listNotes, readLatestNotes } from "./learn-ext.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const notesDir = process.env.LEARN_NOTES_DIR ?? join(root, "learn-notes");
const arg = process.argv[2];
if (arg === "--list") { console.log(listNotes(notesDir).join("\n") || "（還沒有筆記）"); process.exit(0); }
if (arg === "--run-now") { writeFileSync(join(root, "learn-ext", "run-now"), String(Date.now()), { mode: 0o600 }); console.log("已要求守衛跑一次延伸學習（約一分鐘內）。"); process.exit(0); }
const text = readLatestNotes(notesDir, arg);
if (!text) { console.error("（找不到筆記）"); process.exit(1); }
process.stdout.write(text);
