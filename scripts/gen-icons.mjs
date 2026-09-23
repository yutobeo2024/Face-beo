// Sinh icon PNG cho PWA từ public/icon.svg (v1.14.0). Chạy lại khi đổi logo: npm run icons
// File PNG được commit — bản build (Docker) không chạy script này.
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const svg = readFileSync(join(root, "public", "icon.svg"));
const out = join(root, "public", "icons");
const BRAND = "#10695a";

const render = (size) => sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** Ảnh maskable: hệ điều hành cắt tròn / bo góc mạnh → logo thu còn 60%, phần còn lại là nền thương hiệu. */
async function maskable(size) {
  const inner = await sharp(svg, { density: 512 }).resize(Math.round(size * 0.6), Math.round(size * 0.6)).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: inner }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

await mkdir(out, { recursive: true });
const files = {
  "icon-192.png": await render(192),
  "icon-512.png": await render(512),
  "maskable-192.png": await maskable(192),
  "maskable-512.png": await maskable(512),
  // iOS tự bo góc và KHÔNG hỗ trợ nền trong suốt → làm phẳng trên nền thương hiệu.
  "apple-touch-icon.png": await sharp(svg, { density: 512 }).resize(180, 180).flatten({ background: BRAND }).png({ compressionLevel: 9 }).toBuffer(),
};
for (const [name, buf] of Object.entries(files)) {
  await writeFile(join(out, name), buf);
  console.log(`${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}
