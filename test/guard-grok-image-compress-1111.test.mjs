import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import {
  compressImageForGrok,
  GROK_IMAGE_MAX_BASE64,
  GROK_IMAGE_MAX_PROMPT_JSON,
  GROK_IMAGE_MAX_SIDE,
  readQr,
  shrinkForModel,
  shrinkToBudget,
} from "../guard/qr.mjs";
import { grokCli, resetGrokCliState } from "../guard/grok-cli.mjs";

const require = createRequire(new URL("../guard/package.json", import.meta.url));
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

function noisyRgba(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 13) & 255;
    data[i + 1] = (i * 29) & 255;
    data[i + 2] = (i * 47) & 255;
    data[i + 3] = 255;
  }
  return data;
}

function largeJpeg({ width = 1600, height = 1200, quality = 95 } = {}) {
  const encoded = jpeg.encode({ data: noisyRgba(width, height), width, height }, quality);
  const bytes = Buffer.from(encoded.data);
  return { mime: "image/jpeg", bytes, base64: bytes.toString("base64"), width, height };
}

function smallJpeg() {
  const encoded = jpeg.encode({ data: noisyRgba(16, 16), width: 16, height: 16 }, 50);
  const bytes = Buffer.from(encoded.data);
  return { mime: "image/jpeg", bytes, base64: bytes.toString("base64") };
}

function fakeSpawn({ code = 0, stdout = "", stderr = "", delay = 5 } = {}, calls = []) {
  return (bin, args, options) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    setTimeout(() => {
      if (stdout) child.stdout.emit("data", stdout);
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("close", code);
    }, delay);
    return child;
  };
}

test("上限常數：長邊 768、base64 100_000、整段 prompt-json 130_000（低於 Linux 單一參數 131071）", () => {
  assert.equal(GROK_IMAGE_MAX_SIDE, 768);
  assert.equal(GROK_IMAGE_MAX_BASE64, 100_000);
  assert.equal(GROK_IMAGE_MAX_PROMPT_JSON, 130_000);
});

test("shrinkToBudget：把遠超過上限的大 JPEG 壓成 768 以內、base64 ≤ 100_000 的 JPEG，且解得回來", () => {
  const src = largeJpeg();
  assert.ok(src.base64.length > GROK_IMAGE_MAX_BASE64, src.base64.length);
  const out = shrinkToBudget(src.mime, src.bytes);
  assert.ok(out, "應壓得進去");
  assert.equal(out.mime, "image/jpeg");
  assert.ok(out.base64.length <= GROK_IMAGE_MAX_BASE64, out.base64.length);
  assert.ok(Math.max(out.width, out.height) <= GROK_IMAGE_MAX_SIDE, `${out.width}x${out.height}`);
  assert.ok(Math.max(out.width, out.height) >= 384);
  const decoded = jpeg.decode(Buffer.from(out.base64, "base64"), { useTArray: true });
  assert.equal(decoded.width, out.width);
  assert.equal(decoded.height, out.height);
});

test("compressImageForGrok：已小於上限的小圖不重編碼；超大圖會縮並轉 JPEG", () => {
  const small = smallJpeg();
  assert.ok(small.base64.length <= GROK_IMAGE_MAX_BASE64);
  const same = compressImageForGrok(small);
  assert.equal(same, small);
  assert.equal(same.base64, small.base64);
  assert.equal(same.mime, small.mime);

  const src = largeJpeg();
  const out = compressImageForGrok({ mime: src.mime, base64: src.base64 });
  assert.ok(out);
  assert.notEqual(out.base64, src.base64);
  assert.equal(out.mime, "image/jpeg");
  assert.ok(out.base64.length <= GROK_IMAGE_MAX_BASE64);
  assert.ok(Math.max(out.width, out.height) <= GROK_IMAGE_MAX_SIDE);
});

test("compressImageForGrok：沒有圖或解不開的超長資料回 undefined，不丟例外", () => {
  assert.equal(compressImageForGrok(undefined), undefined);
  assert.equal(compressImageForGrok({}), undefined);
  assert.equal(compressImageForGrok({ mime: "image/png", base64: "A".repeat(GROK_IMAGE_MAX_BASE64 + 1) }), undefined);
  assert.equal(compressImageForGrok({ mime: "application/octet-stream", base64: "AAAA".repeat(30_000) }), undefined);
});

test("grokCli：超大圖會先壓縮再送，用 imageModel，prompt-json 在上限內", async () => {
  resetGrokCliState();
  const calls = [];
  const src = largeJpeg();
  const workDir = mkdtempSync(join(tmpdir(), "grokimg-"));
  await grokCli({ backend: "grok-cli", workDir, bin: "/fake/grok", sandbox: "", imageModel: "grok-4.7" }, "S", "看圖", {
    image: { mime: src.mime, base64: src.base64 },
    spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "OK 測試" }) }, calls),
  });
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  assert.equal(args[args.indexOf("-m") + 1], "grok-4.7");
  const payload = JSON.parse(args[args.indexOf("--prompt-json") + 1]);
  assert.equal(payload[0].type, "image");
  assert.equal(payload[0].mimeType, "image/jpeg");
  assert.ok(payload[0].data.length <= GROK_IMAGE_MAX_BASE64, payload[0].data.length);
  assert.ok(payload[0].data.length < src.base64.length);
  assert.ok(args[args.indexOf("--prompt-json") + 1].length <= GROK_IMAGE_MAX_PROMPT_JSON);
  assert.equal(payload[1].type, "text");
  assert.equal(payload[1].text, "看圖");
});

test("grokCli：縮失敗且原圖超過上限 → IMAGE_TOO_LARGE，不呼叫 CLI", async () => {
  resetGrokCliState();
  const calls = [];
  const workDir = mkdtempSync(join(tmpdir(), "grokimg-"));
  await assert.rejects(grokCli({ backend: "grok-cli", workDir, bin: "/fake/grok", sandbox: "" }, "S", "x", {
    image: { mime: "image/png", base64: "A".repeat(GROK_IMAGE_MAX_BASE64 + 1) },
    spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "OK" }) }, calls),
  }), /IMAGE_TOO_LARGE/);
  assert.equal(calls.length, 0);
});

test("grokCli：圖已在上限內，但提示過長讓整段 prompt-json 超過 130_000 → IMAGE_TOO_LARGE，不呼叫 CLI", async () => {
  resetGrokCliState();
  const calls = [];
  const workDir = mkdtempSync(join(tmpdir(), "grokimg-"));
  const small = smallJpeg();
  const user = "看圖" + "啊".repeat(GROK_IMAGE_MAX_PROMPT_JSON);
  await assert.rejects(grokCli({ backend: "grok-cli", workDir, bin: "/fake/grok", sandbox: "" }, "S", user, {
    image: small,
    spawnImpl: fakeSpawn({ stdout: JSON.stringify({ text: "OK" }) }, calls),
  }), /IMAGE_TOO_LARGE/);
  assert.equal(calls.length, 0);
});

test("QR 解碼仍用原圖：大圖壓縮不改傳入的 bytes，readQr 結果不變", async () => {
  const qrPng = PNG.sync.read(await QRCode.toBuffer("https://line.me/ti/g2/TestTicket0001", { width: 400, margin: 2 }));
  const width = 1800, height = 1400, ox = 100, oy = 100;
  const data = noisyRgba(width, height);
  for (let y = 0; y < qrPng.height; y += 1) {
    for (let x = 0; x < qrPng.width; x += 1) {
      const si = (y * qrPng.width + x) * 4;
      const di = ((y + oy) * width + (x + ox)) * 4;
      data[di] = qrPng.data[si];
      data[di + 1] = qrPng.data[si + 1];
      data[di + 2] = qrPng.data[si + 2];
      data[di + 3] = 255;
    }
  }
  const canvas = new PNG({ width, height });
  canvas.data.set(data);
  const bytes = PNG.sync.write(canvas);
  assert.ok(bytes.toString("base64").length > GROK_IMAGE_MAX_BASE64);
  const found = readQr("image/png", bytes);
  assert.equal(found, "https://line.me/ti/g2/TestTicket0001");
  const snapshot = Buffer.from(bytes);
  const compressed = compressImageForGrok({ mime: "image/png", base64: bytes.toString("base64") });
  assert.ok(compressed);
  assert.equal(compressed.mime, "image/jpeg");
  assert.ok(compressed.base64.length <= GROK_IMAGE_MAX_BASE64);
  assert.ok(bytes.equals(snapshot), "壓縮不得改寫原圖 bytes");
  assert.equal(readQr("image/png", bytes), found);
});

test("shrinkForModel 行為不變：預設長邊 768、轉 JPEG", () => {
  const src = largeJpeg({ width: 1200, height: 900, quality: 80 });
  const out = shrinkForModel(src.mime, src.bytes);
  assert.ok(out);
  assert.equal(out.mime, "image/jpeg");
  assert.ok(Math.max(out.width, out.height) <= 768);
  assert.ok(out.base64.length > 0);
});
