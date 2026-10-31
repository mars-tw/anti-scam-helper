// 詐騙話術範例庫：給地端初篩與 Meta 覆核當 few-shot 範例，並累積 Meta 確認為詐騙的訊息（去識別化）。
// 檔案（本機，data/ 不進 git）：
//   <dir>/library.json   官方公告手法整理的示意範例（label SCAM／OK、category）
//   <dir>/confirmed.jsonl 守衛自動累積：Meta 覆核判 SCAM 的訊息（去識別化，權限 600）
// 沒有 <dir>/library.json 時改讀 guard/scam-patterns.example.json（同內容，可公開）。
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function bigrams(text) {
  const clean = String(text ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const gram of a) if (b.has(gram)) common++;
  return common / (a.size + b.size - common);
}

/** 去掉連結佔位（［連結：…］）、空白與標點後剩下的字。只剩連結的訊息沒有可學的話術，當 SCAM 範例只會教模型「有連結就是詐騙」。 */
export function patternBody(text) {
  return String(text ?? "").replace(/［連結：[^］]*］/g, "").replace(/[\s\p{P}\p{S}]+/gu, "");
}
/** 能不能當 SCAM 範例：去掉連結後至少 8 個字。 */
export function learnablePattern(text) {
  return patternBody(text).length >= 8;
}

export class ScamPatterns {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch {}
    this.cache = { at: 0, items: [] };
  }
  load() {
    if (Date.now() - this.cache.at < 60_000) return this.cache.items;
    const items = [];
    const bad = [];
    const library = [join(this.dir, "library.json"), join(here, "scam-patterns.example.json")].find((path) => existsSync(path));
    try {
      for (const example of JSON.parse(readFileSync(library, "utf8")).examples ?? []) items.push({ ...example, source: "library" });
    } catch {}
    try {
      for (const line of readFileSync(join(this.dir, "confirmed.jsonl"), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        // 只有連結、沒有話術的舊紀錄不當範例（自動反思 10/25：一般科技／知識網址被誤當詐騙範例）。
        if (entry.label === "bad") { bad.push({ grams: bigrams(String(entry.text ?? "")) }); continue; }
        if (learnablePattern(entry.text)) items.push({ label: "SCAM", category: entry.category ?? "Meta 確認", text: entry.text, source: "confirmed" });
      }
    } catch {}
    for (const item of items) item.grams = bigrams(item.text);
    // 自動反思 10/30：標 bad（誤判）的舊紀錄不當範例，也記下來讓 addConfirmed 不再把幾乎一樣的訊息收回去。
    this.cache = { at: Date.now(), items, bad };
    return items;
  }
  /** 挑最相近的 scam 筆 SCAM 範例與 ok 筆 OK 範例。 */
  examples(text, scam = 2, ok = 1, maxChars = 90) {
    const grams = bigrams(text);
    const ranked = this.load().map((item) => ({ item, score: similarity(grams, item.grams) })).sort((a, b) => b.score - a.score);
    const pick = (label, n) => ranked.filter(({ item }) => item.label === label).slice(0, n).map(({ item }) => ({ label, text: item.text.slice(0, maxChars) }));
    return [...pick("SCAM", scam), ...pick("OK", ok)];
  }
  /** 格式化成提示用的範例段落。 */
  fewShot(text, scam, ok, maxChars) {
    const list = this.examples(text, scam, ok, maxChars);
    if (!list.length) return "";
    return `參考範例（只學判斷方式）：\n${list.map((e) => `「${e.text}」→ ${e.label}`).join("\n")}\n\n`;
  }
  /** 累積 Meta 確認的詐騙訊息（呼叫端須先去識別化）；和既有範例幾乎一樣的就不重複存。 */
  addConfirmed(text, category, meta = {}) {
    const clean = String(text ?? "").trim().slice(0, 400);
    if (clean.length < 8 || !learnablePattern(clean)) return false;
    const grams = bigrams(clean);
    if (this.load().some((item) => similarity(grams, item.grams) > 0.85)) return false;
    if ((this.cache.bad ?? []).some((item) => similarity(grams, item.grams) > 0.85)) return false;
    const path = join(this.dir, "confirmed.jsonl");
    if (!existsSync(path)) appendFileSync(path, "", { mode: 0o600 });
    chmodSync(path, 0o600);
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), label: "", category, text: clean, ...meta })}\n`);
    this.cache.at = 0;
    return true;
  }
}
