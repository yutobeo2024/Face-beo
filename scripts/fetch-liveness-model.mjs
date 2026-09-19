// Tải mô hình L2 chống giả mạo (MiniFASNetV2, Silent-Face-Anti-Spoofing — Apache-2.0) và kiểm tra SHA-256.
// Nguồn ONNX: https://github.com/yakhyo/face-anti-spoofing (Apache-2.0), chuyển đổi từ minivision-ai/Silent-Face-Anti-Spoofing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const URL = "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx";
const SHA256 = "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907";
const dest = process.env.LIVENESS_MODEL_PATH || join(process.cwd(), "models", "MiniFASNetV2.onnx");
const sha = (b) => createHash("sha256").update(b).digest("hex");

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log("[models:liveness] Đã có mô hình hợp lệ:", dest);
  process.exit(0);
}
console.log("[models:liveness] Đang tải", URL);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const got = sha(buf);
if (got !== SHA256) throw new Error(`Sai SHA-256: ${got} (mong đợi ${SHA256}) — không lưu file`);
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, buf);
console.log(`[models:liveness] Đã lưu ${dest} (${buf.length} byte, SHA-256 khớp)`);
