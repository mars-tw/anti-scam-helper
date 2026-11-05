// 11/5 日誌補記「命中網域」：只給稽核回讀用，不參與任何判定、分數、門檻。
// 只記主機名（小寫、去 www.），不記路徑與查詢參數；每則最多 5 個。
import { extractUrls } from "./redpacket.mjs";

const MAX = 5;

export function domainsOf(...texts) {
  const out = [];
  for (const text of texts) {
    for (const url of extractUrls(text)) {
      try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        if (host && !out.includes(host)) out.push(host);
      } catch {}
      if (out.length >= MAX) return out;
    }
  }
  return out;
}

/** messageId → 網域表（有上限，舊的先丟）。 */
export function createDomainLog(limit = 2000) {
  const map = new Map();
  return {
    note(messageId, ...texts) {
      if (!messageId) return;
      const found = domainsOf(...texts);
      if (!found.length) return;
      const merged = [...new Set([...(map.get(messageId) ?? []), ...found])].slice(0, MAX);
      map.delete(messageId);
      map.set(messageId, merged);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    /** 回傳加上 domains 的新物件；原本已有 domains 或查不到就原樣回傳。不改其他欄位。 */
    tag(entry) {
      if (!entry || entry.domains !== undefined || !entry.messageId) return entry;
      const found = map.get(entry.messageId);
      return found?.length ? { ...entry, domains: found } : entry;
    },
  };
}
