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

const LINE_INVITE = /(^|\/\/|\.)(line\.me\/(R\/)?ti\/(g2?|p)\/|line\.me\/R\/(ti|nv|oaMessage)|lin\.ee\/|liff\.line\.me\/|qr-official\.line\.me\/|page\.line\.me\/)/i;

/** QR 內容是 LINE 群組、社群、好友或官方帳號的邀請連結。 */
export function isLineInvite(text) {
  return LINE_INVITE.test(text);
}
