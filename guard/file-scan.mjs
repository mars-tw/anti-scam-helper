// 維護者 10/26 23:15：「詐騙傳的檔案裡面也一定會有群組 QR 或是連結」。
// 群裡傳的檔案（PDF／圖片）：抽文字連結、把每頁轉成圖掃 QR。只回傳抽出來的結果，不判斷、不處置。
// 防護：限制大小、頁數、每個外部程式的時間；檔案只放在暫存資料夾（700），處理完一律刪掉；壞檔／惡意檔只回 error，不丟例外。
// 需要主機有 poppler-utils（pdftotext、pdftoppm）；沒有就回 error: "NO_POPPLER"，守衛照舊不處理檔案。
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQr } from "./qr.mjs";

export const FILE_SCAN_DEFAULTS = { maxBytes: 10 * 1024 * 1024, maxPages: 10, timeoutMs: 15_000, dpi: 110, maxTextChars: 20_000 };
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'）)」』]+|(?:line\.me|lin\.ee|openchat\.line\.me)\/[^\s<>"'）)」』]+/gi;

export function sniffFile(bytes) {
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return undefined;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } }, (error, stdout) => {
      resolve(error ? { error: error.code === "ENOENT" ? "NO_POPPLER" : error.killed ? "TIMEOUT" : "TOOL_FAILED", stdout: "" } : { stdout: String(stdout) });
    });
  });
}

/** @returns {Promise<{ kind?: string, text: string, urls: string[], qrs: string[], pages: number, error?: string }>} */
export async function scanFile(bytes, options = {}) {
  const o = { ...FILE_SCAN_DEFAULTS, ...options };
  const out = { text: "", urls: [], qrs: [], pages: 0 };
  let dir;
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ...out, error: "EMPTY" };
    if (bytes.length > o.maxBytes) return { ...out, error: "TOO_LARGE" };
    const kind = sniffFile(bytes);
    out.kind = kind;
    if (!kind) return { ...out, error: "UNSUPPORTED" };
    if (kind.startsWith("image/")) {
      const qr = (() => { try { return readQr(kind, bytes); } catch { return undefined; } })();
      if (qr) out.qrs.push(qr);
      return out;
    }
    dir = mkdtempSync(join(o.tmpRoot ?? tmpdir(), "guard-file-"));
    const pdf = join(dir, "in.pdf");
    writeFileSync(pdf, bytes, { mode: 0o600 });
    const deadline = Date.now() + o.timeoutMs;
    const left = () => Math.max(1000, deadline - Date.now());
    const text = await run(o.pdftotext ?? "pdftotext", ["-q", "-l", String(o.maxPages), "-enc", "UTF-8", pdf, "-"], left());
    if (text.error === "NO_POPPLER") return { ...out, error: "NO_POPPLER" };
    out.text = text.stdout.slice(0, o.maxTextChars);
    // 連結註解（文字裡看不到、但點得到的連結）：PDF 原始內容裡的 /URI (...)。
    const raw = bytes.toString("latin1");
    const uris = [...raw.matchAll(/\/URI\s*\(([^)]{4,500})\)/g)].map((m) => m[1]);
    out.urls = [...new Set([...(out.text.match(URL_RE) ?? []), ...uris])].slice(0, 50);
    if (Date.now() < deadline) {
      const r = await run(o.pdftoppm ?? "pdftoppm", ["-q", "-r", String(o.dpi), "-l", String(o.maxPages), "-png", pdf, join(dir, "p")], left());
      if (r.error === "TIMEOUT") out.error = "TIMEOUT";
      const pngs = readdirSync(dir).filter((f) => f.endsWith(".png")).sort().slice(0, o.maxPages);
      out.pages = pngs.length;
      for (const png of pngs) {
        if (Date.now() > deadline) { out.error = "TIMEOUT"; break; }
        try { const qr = readQr("image/png", readFileSync(join(dir, png))); if (qr) out.qrs.push(qr); } catch {}
      }
    } else out.error = "TIMEOUT";
    return out;
  } catch (error) {
    return { ...out, error: "SCAN_FAILED" };
  } finally {
    if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
