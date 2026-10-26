// 測試用假 PDF（自己產生，不用外部檔案）：可放一行 ASCII 文字與一張 QR 圖（未壓縮 RGB）。
import QRCode from "qrcode";
import pngjs from "pngjs";

export async function makePdf({ text = "", qr } = {}) {
  const objs = [];
  let img = "";
  let imgObj;
  if (qr) {
    const png = pngjs.PNG.sync.read(await QRCode.toBuffer(qr, { width: 240, margin: 2 }));
    const rgb = Buffer.alloc(png.width * png.height * 3);
    for (let i = 0; i < png.width * png.height; i++) { rgb[i * 3] = png.data[i * 4]; rgb[i * 3 + 1] = png.data[i * 4 + 1]; rgb[i * 3 + 2] = png.data[i * 4 + 2]; }
    imgObj = { w: png.width, h: png.height, rgb };
    img = `q 240 0 0 240 100 400 cm /Im1 Do Q\n`;
  }
  const esc = (s) => s.replace(/[\\()]/g, "\\$&");
  const content = `${text ? `BT /F1 14 Tf 72 720 Td (${esc(text)}) Tj ET\n` : ""}${img}`;
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >>${imgObj ? " /XObject << /Im1 6 0 R >>" : ""} >> /Contents 4 0 R >>`);
  objs.push(Buffer.concat([Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n`), Buffer.from(content), Buffer.from("\nendstream")]));
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  if (imgObj) objs.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${imgObj.w} /Height ${imgObj.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imgObj.rgb.length} >>\nstream\n`), imgObj.rgb, Buffer.from("\nendstream")]));
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [];
  let size = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from("\nendobj\n")]);
    offsets.push(size); parts.push(b); size += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
