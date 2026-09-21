// Chạy trước mỗi file test: dùng DB và thư mục dữ liệu riêng, tắt Zalo thật và cron.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Chặn Next.js (@next/env) tự nạp .env khi test import route handler: nếu không, khóa Zalo THẬT trong .env của máy
// chạy server bị nạp lại sau khi xóa ở dưới => test gọi API Zalo thật; TRUSTED_PROXY_HOPS, LIVENESS_SERVER… cũng lệch.
// @next/env không ghi đè khóa đã có trong process.env lúc nó nạp lần đầu => khai báo trước mọi khóa của các file .env* là "".
process.env.__NEXT_PROCESSED_ENV = "true";
for (const f of readdirSync(process.cwd()).filter((n) => n.startsWith(".env") && n !== ".env.example")) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = "";
  }
}

process.env.DATABASE_URL = "file:../data/test.db";
process.env.DATA_DIR = join(process.cwd(), "data", "test-data");
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.BIOMETRIC_KEY = "11".repeat(32);
process.env.CRON_SECRET = "test-cron-secret";
process.env.DISABLE_CRON = "true";
// Gán "" thay vì xóa: Prisma Client và @next/env chỉ nạp .env cho khóa CHƯA tồn tại (xóa => khóa thật bị nạp lại).
for (const k of ["ZALO_OA_APP_ID", "ZALO_OA_SECRET", "ZALO_OA_ACCESS_TOKEN", "ZALO_OA_REFRESH_TOKEN", "ZALO_WEBHOOK_SECRET"]) {
  process.env[k] = "";
}
