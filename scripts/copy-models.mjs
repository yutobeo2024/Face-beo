// Sao chép model của @vladmandic/human sang public/models để kiosk tải từ cùng origin.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = join(process.cwd(), "node_modules", "@vladmandic", "human", "models");
const dest = join(process.cwd(), "public", "models");
const needed = [
  "blazeface.json", "blazeface.bin",
  "facemesh.json", "facemesh.bin",
  "iris.json", "iris.bin",
  "antispoof.json", "antispoof.bin",
  "liveness.json", "liveness.bin",
];
if (!existsSync(src)) {
  console.warn("[copy-models] Không tìm thấy", src, "- bỏ qua");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of needed) {
  if (existsSync(join(src, f))) { cpSync(join(src, f), join(dest, f)); n++; }
  else console.warn("[copy-models] thiếu", f);
}
console.log(`[copy-models] Đã chép ${n} file model vào public/models`);
