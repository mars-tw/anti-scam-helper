// 在本機解讀圖片裡的 QR code（免費、不送出圖片），並分辨是不是 LINE 群組／社群邀請或加好友連結。
import jpeg from "jpeg-js";
import jsQR from "jsqr";
import omggif from "omggif";
import pngjs from "pngjs";

const { PNG } = pngjs;

function decodeImage(mime, bytes) {
  if (mime === "image/jpeg") {
    const image = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length) };
  }
  if (mime === "image/png") {
    const image = PNG.sync.read(bytes);
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length) };
  }
  if (mime === "image/gif") {
    const reader = new omggif.GifReader(bytes);
    const data = new Uint8ClampedArray(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, data);
    return { width: reader.width, height: reader.height, data };
  }
  return undefined;
}

/** 縮成一半（2×2 取平均）：大張照片裡的小 QR code，縮小後反而較容易被找到。 */
function half(image) {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const at = (dy, dx) => image.data[((y * 2 + dy) * image.width + (x * 2 + dx)) * 4 + c];
        data[(y * width + x) * 4 + c] = (at(0, 0) + at(0, 1) + at(1, 0) + at(1, 1)) / 4;
      }
    }
  }
  return { width, height, data };
}

/** 依比例縮小（scale < 1），每個新像素取原圖對應區塊的平均。 */
function resize(image, scale) {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) / scale)));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          for (let c = 0; c < 4; c += 1) sum[c] += image.data[(sy * image.width + sx) * 4 + c];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c += 1) data[(y * width + x) * 4 + c] = sum[c] / count;
    }
  }
  return { width, height, data };
}

/** 回傳圖片中 QR code 的文字內容；沒有或無法解讀時回 undefined。 */
export function readQr(mime, bytes) {
  let image = decodeImage(mime, bytes);
  if (!image) return undefined;
  // 原尺寸掃大照片很慢（數十秒），先縮到長邊 1600 以內再掃，找不到再縮一次。
  while (Math.max(image.width, image.height) > 1600) image = half(image);
  for (let attempt = 0; attempt < 2 && image.width >= 50 && image.height >= 50; attempt += 1) {
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (found?.data) return found.data;
    if (Math.max(image.width, image.height) < 800) break;
    image = half(image);
  }
  return undefined;
}

/**
 * 縮成長邊不超過 maxSide 的 JPEG（base64），給看圖模型用：CPU 上的小模型看小圖快很多。
 * 無法解讀時回 undefined。
 */
export function shrinkForModel(mime, bytes, maxSide = 768) {
  let image = decodeImage(mime, bytes);
  if (!image) return undefined;
  // 先對半縮到兩倍以內（快），再精準縮到 maxSide：縮過頭的話，圖中小字模型就讀不出來。
  while (Math.max(image.width, image.height) > maxSide * 2) image = half(image);
  if (Math.max(image.width, image.height) > maxSide) image = resize(image, maxSide / Math.max(image.width, image.height));
  const encoded = jpeg.encode({ data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length), width: image.width, height: image.height }, 85);
  return { mime: "image/jpeg", base64: Buffer.from(encoded.data).toString("base64"), width: image.width, height: image.height };
}

const LINE_INVITE = /(^|\/\/|\.)(line\.me\/(R\/)?ti\/(g2?|p)\/|line\.me\/R\/(ti|nv|oaMessage)|lin\.ee\/|liff\.line\.me\/|qr-official\.line\.me\/|page\.line\.me\/|openchat\.line\.me\/[a-z]{2}\/(cover|join)|square\.line\.me\/)|^line:\/\/(ti|nv|msg)\//i;

/** QR 內容是 LINE 群組、社群、好友或官方帳號的邀請連結。 */
export function isLineInvite(text) {
  return LINE_INVITE.test(text);
}

// ── 本群／別群 ─────────────────────────────────────────────
const SQUARE_TICKET = /^(?:https?:\/\/)?(?:[\w-]+\.)*line\.me\/(?:R\/)?ti\/g2\/([\w-]{4,100})|^(?:https?:\/\/)?openchat\.line\.me\/[a-z]{2}(?:-[a-z]{2,4})?\/(?:cover|join)\/([\w-]{4,100})/i;

/** 社群（OpenChat）邀請碼：line.me/ti/g2/<碼>、openchat.line.me/<地區>/cover|join/<碼>。一般群組 ti/g/ 與加好友不算（回 undefined）。 */
export function squareTicket(text) {
  const match = String(text ?? "").trim().match(SQUARE_TICKET);
  return match ? match[1] ?? match[2] : undefined;
}

/**
 * QR 連結是不是本群（同一個社群）自己的：
 * 1. 和本群現有邀請連結的邀請碼相同 → own（via: "own-link"）
 * 2. 是社群邀請碼：反查所屬社群，和本群同一個社群 → own（"lookup"）；別的社群 → other（"lookup"）
 * 3. 一般群組 ti/g/、加好友、查不到 → unknown（交給既有白名單與覆核流程）。
 * own：{ squareMid?, links: [] }；lookup(ticket) → { squareMid } | undefined（查無）| 丟錯（無法確認）。
 */
export async function classifyQrOrigin(content, { own, lookup } = {}) {
  const ticket = squareTicket(content);
  if (!ticket) return { origin: "unknown", via: "not-square" };
  const ownTickets = new Set((own?.links ?? []).map(squareTicket).filter(Boolean));
  if (ownTickets.has(ticket)) return { origin: "own", via: "own-link" };
  if (!own?.squareMid || typeof lookup !== "function") return { origin: "unknown", via: "no-own-info" };
  let found;
  try { found = await lookup(ticket); } catch { return { origin: "unknown", via: "lookup-failed" }; }
  if (!found?.squareMid) return { origin: "unknown", via: "lookup-not-found" };
  return found.squareMid === own.squareMid ? { origin: "own", via: "lookup" } : { origin: "other", via: "lookup" };
}

/** 覆核提示：只有確認是別的社群才寫「不是本社群自己的連結」。 */
export function qrReviewContext(origin) {
  if (origin === "other") return "一般成員（非管理員）在本社群貼出一張截圖，截圖裡的 QR code 解碼後是 LINE 社群邀請連結，已向 LINE 查證屬於別的社群（不是本社群）。請判斷這是否為引流詐騙。";
  return "一般成員（非管理員）在本社群貼出一張截圖，截圖裡的 QR code 解碼後是 LINE 群組／社群／加好友邀請連結；無法確認是不是本社群自己的連結（也可能是本群正式邀請）。請判斷這是否為引流詐騙，證據不足時回 UNSURE。";
}
