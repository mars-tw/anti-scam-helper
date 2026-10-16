// 聊天應答學習資料庫（只存在本機，不上傳）：去識別化的 @本人 問答與本人發言範例，
// 回應時用字元雙字組（bigram）相似度挑相近的好範例放進提示，讓語氣越來越像本人。
// ⚠️ 會把訊息（去識別化後）寫進硬碟，違背「訊息不落盤」的預設，所以守衛預設不啟用；
// 只有設定檔 chat.training.enabled: true 才會建立這個資料庫（隱私警告見 guard/README.md）。
// 檔案：<dir>/qa.jsonl（自動收集的問答）、<dir>/style.jsonl（本人歷史發言）。
// 人工標記：把某一行的 "label" 改成 "good" 或 "bad"（bad 不會被拿來當範例），"note" 可寫備註。
import { appendFileSync, existsSync, mkdirSync, readFileSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 去識別化：手機、市話、身分證、email、帳號／卡號、地址、LINE ID、網址（165 除外）、已知姓名換代號。 */
export function deidentify(text, names = []) {
  let out = String(text ?? "");
  const codes = new Map();
  for (const name of [...new Set(names)].filter((n) => n && n.length >= 2).sort((a, b) => b.length - a.length)) {
    if (!codes.has(name)) codes.set(name, `成員${String.fromCharCode(65 + (codes.size % 26))}`);
    out = out.split(name).join(codes.get(name));
  }
  return out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "［email］")
    .replace(/https?:\/\/(?!165\.npa\.gov\.tw)[^\s，。）)]+/gi, "［網址］")
    .replace(/\b[A-Z][12]\d{8}\b/g, "［身分證］")
    .replace(/(\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "［手機］")
    .replace(/\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{4}/g, "［電話］")
    .replace(/\b\d{10,16}\b/g, "［帳號］")
    .replace(/(line\s*id|ID)\s*[:：]?\s*@?[\w.-]{3,}/gi, "［LINE ID］")
    .replace(/@[\w.-]{4,}/g, "［ID］")
    .replace(/[\u4e00-\u9fa5]{1,6}(縣|市)[\u4e00-\u9fa5]{1,6}(區|鄉|鎮|市)[\u4e00-\u9fa50-9０-９\-之]{1,20}(號|樓)/g, "［地址］")
    .replace(/[\u4e00-\u9fa5]{1,10}(路|街|大道)([\u4e00-\u9fa50-9０-９]{1,4}段)?([0-9０-９]{1,4}巷)?([0-9０-９]{1,4}弄)?[0-9０-９]{1,5}號([0-9０-９]{1,3}樓)?/g, "［地址］");
}

export class TrainingStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { chmodSync(dir, 0o700); } catch {}
    this.cache = { at: 0, items: [] };
  }
  file(name) {
    const path = join(this.dir, name);
    if (!existsSync(path)) { appendFileSync(path, "", { mode: 0o600 }); chmodSync(path, 0o600); }
    return path;
  }
  append(name, entry) {
    appendFileSync(this.file(name), `${JSON.stringify({ id: randomUUID(), label: null, note: "", ...entry })}\n`);
    this.cache.at = 0;
  }
  load() {
    const mtimes = ["qa.jsonl", "style.jsonl"].map((name) => { try { return statSync(join(this.dir, name)).mtimeMs; } catch { return 0; } });
    const stamp = Math.max(...mtimes);
    if (this.cache.at === stamp && stamp !== 0) return this.cache.items;
    const items = [];
    for (const name of ["qa.jsonl", "style.jsonl"]) {
      let raw = "";
      try { raw = readFileSync(join(this.dir, name), "utf8"); } catch { continue; }
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.label === "bad" || !item.answer) continue;
          items.push({ ...item, grams: bigrams(`${item.question ?? ""} ${item.answer}`) });
        } catch {}
      }
    }
    this.cache = { at: stamp, items };
    return items;
  }
  /** 挑最相近的 k 個範例；人工標 good 的加分。 */
  similar(query, k = 3) {
    const q = bigrams(query);
    if (q.size === 0) return [];
    return this.load()
      .map((item) => ({ item, score: jaccard(q, item.grams) + (item.label === "good" ? 0.15 : 0) }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.item);
  }
}

function bigrams(text) {
  const clean = String(text).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter === 0 ? 0 : inter / (a.size + b.size - inter);
}
