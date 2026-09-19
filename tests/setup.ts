// Chạy trước mỗi file test: dùng DB và thư mục dữ liệu riêng, tắt Zalo thật và cron.
import { join } from "node:path";

process.env.DATABASE_URL = "file:../data/test.db";
process.env.DATA_DIR = join(process.cwd(), "data", "test-data");
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.BIOMETRIC_KEY = "11".repeat(32);
process.env.CRON_SECRET = "test-cron-secret";
process.env.DISABLE_CRON = "true";
for (const k of ["ZALO_OA_APP_ID", "ZALO_OA_SECRET", "ZALO_OA_ACCESS_TOKEN", "ZALO_OA_REFRESH_TOKEN", "ZALO_WEBHOOK_SECRET"]) {
  delete process.env[k];
}
