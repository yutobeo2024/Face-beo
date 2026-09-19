// Tải mô hình nhận diện khuôn mặt InsightFace (MIT) từ bản phát hành chính thức trên GitHub và kiểm tra SHA-256.
//   npm run models:face          -> buffalo_l.zip (288 MB) -> models/w600k_r50.onnx (ResNet50, chính xác hơn — mặc định)
//   npm run models:face -- mbf   -> buffalo_sc.zip (15 MB)  -> models/w600k_mbf.onnx (MobileFaceNet, nhẹ hơn)
// Chỉ giải nén đúng file .onnx cần dùng (đọc zip bằng zlib, không cần thư viện ngoài).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const SOURCES = {
  r50: {
    url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
    zipSha: "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f",
    entry: "w600k_r50.onnx",
    sha: "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
  },
  mbf: {
    url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
    zipSha: "57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72",
    entry: "w600k_mbf.onnx",
    sha: "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f",
  },
};

const key = process.argv[2] === "mbf" ? "mbf" : "r50";
const src = SOURCES[key];
const dest = process.env.FACE_MODEL_PATH || join(process.cwd(), "models", src.entry);
const sha = (b) => createHash("sha256").update(b).digest("hex");

if (existsSync(dest) && sha(readFileSync(dest)) === src.sha) {
  console.log("[models:face] Đã có mô hình hợp lệ:", dest);
  process.exit(0);
}
console.log(`[models:face] Đang tải ${src.url} (${key === "r50" ? "~288 MB" : "~15 MB"})…`);
const res = await fetch(src.url);
if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const gotZip = sha(zip);
if (gotZip !== src.zipSha) throw new Error(`Sai SHA-256 của file zip: ${gotZip} (mong đợi ${src.zipSha})`);
const onnx = extractEntry(zip, src.entry);
const got = sha(onnx);
if (got !== src.sha) throw new Error(`Sai SHA-256 của ${src.entry}: ${got} (mong đợi ${src.sha}) — không lưu file`);
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, onnx);
console.log(`[models:face] Đã lưu ${dest} (${onnx.length} byte, SHA-256 khớp). Đặt FACE_EMBED_MODEL=${key} nếu khác mặc định (r50).`);

/** Đọc một entry từ zip: tìm End of Central Directory, duyệt Central Directory, giải nén (store hoặc deflate). */
function extractEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Không phải file zip hợp lệ");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Central directory hỏng");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (entryName !== name && !entryName.endsWith("/" + name)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Local header hỏng");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    const out = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!out) throw new Error(`Phương pháp nén ${method} không hỗ trợ`);
    if (out.length !== usize) throw new Error("Kích thước giải nén không khớp");
    return out;
  }
  throw new Error(`Không thấy ${name} trong zip`);
}
