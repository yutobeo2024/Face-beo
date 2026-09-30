// Tải mô hình đặc trưng ảnh cho kiểm đồng phục (v1.20.0) và kiểm SHA-256.
//
// Mô hình: MobileCLIP-S0 — phần mã hóa ẢNH, bản lượng tử hóa int8 (~11,8 MB), vector 512 chiều.
// Nguồn ONNX: https://huggingface.co/Xenova/mobileclip_s0 (chuyển đổi từ apple/ml-mobileclip, giấy phép Apple ASCL).
// Tiền xử lý: ảnh RGB 256×256, chỉ chia 255 — KHÔNG chuẩn hóa mean/std (preprocessor_config.json: do_normalize=false).
//
// Đây là TÍN HIỆU PHỤ: thiếu mô hình thì việc kiểm vẫn chạy bằng màu áo + logo, chỉ thận trọng hơn.
// Đổi mô hình khác thì phải đổi cả UNIFORM_MODEL_VERSION (để mẫu áo được tính lại) và UNIFORM_INPUT_SIZE nếu khác 256.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const URL = "https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model_quantized.onnx";
const SHA256 = "fcbd153d1aa1314fb72ea39b20c37e0572e7e7b05359b51f3efee5d682658472";
const dest = process.env.UNIFORM_MODEL_PATH || join(process.cwd(), "models", "uniform.onnx");
const sha = (b) => createHash("sha256").update(b).digest("hex");

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log("[models:uniform] Đã có mô hình hợp lệ:", dest);
  process.exit(0);
}
console.log("[models:uniform] Đang tải", URL);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Tải thất bại: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const got = sha(buf);
if (got !== SHA256) throw new Error(`Sai SHA-256: ${got} (mong đợi ${SHA256}) — không lưu file`);
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, buf);
console.log(`[models:uniform] Đã lưu ${dest} (${buf.length} byte, SHA-256 khớp)`);
console.log('[models:uniform] Đã có mẫu áo rồi thì tính lại đặc trưng: mở /admin/uniform/templates, xóa rồi tải lại một ảnh mẫu của từng mẫu áo.');
