// Tải mô hình đặc trưng ảnh cho kiểm đồng phục (v1.20.0) và kiểm SHA-256.
//
// Mô hình: DINOv2-small, bản lượng tử hóa int8 (~24 MB), vector 384 chiều (trung bình các ô ảnh).
// Nguồn ONNX: https://huggingface.co/onnx-community/dinov2-small (chuyển đổi từ facebook/dinov2-small, Apache-2.0).
// Tiền xử lý: ảnh RGB 224×224, chuẩn hóa theo ImageNet (mean/std trong src/lib/uniform-embed.ts).
//
// VÌ SAO LÀ DINOv2: đo trên ảnh thật của phòng khám (6 ảnh mặc đúng đồng phục, 4 ảnh mặc sai), MobileCLIP-S0 chấm
// áo đen thường CAO HƠN áo đồng phục — nó chỉ nhận ra "người mặc áo sẫm", không phân biệt được áo. DINOv2 tách đúng
// hướng (khoảng cách 0,103), gộp với tín hiệu màu thì khoảng cách lên ~0,26.
//
// Đây là TÍN HIỆU PHỤ: thiếu mô hình thì việc kiểm vẫn chạy bằng màu áo + logo, chỉ thận trọng hơn.
// Đổi mô hình khác thì phải đổi UNIFORM_MODEL_VERSION (mẫu áo sẽ được tính lại), UNIFORM_INPUT_SIZE và mean/std.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const URL = "https://huggingface.co/onnx-community/dinov2-small/resolve/main/onnx/model_quantized.onnx";
const SHA256 = "c179f8f7f592449c4c1bca4cd124a7538021428c5ffb89afde9503935b197efb";
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
