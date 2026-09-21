// Tạo DB test sạch + seed một lần trước toàn bộ test tích hợp.
import { execSync } from "node:child_process";
import { join } from "node:path";

export default function setup() {
  if (process.env.SKIP_DB_SETUP === "1") return;
  const env = {
    ...process.env,
    DATABASE_URL: "file:../data/test.db",
    // Thư mục file của dữ liệu test (ảnh đại diện, file scan…) — seed demo xóa thư mục ảnh ở đây, KHÔNG phải data/ thật (v1.10.3).
    DATA_DIR: join(process.cwd(), "data", "test-data"),
    BIOMETRIC_KEY: "11".repeat(32),
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    // Tiến trình con (Prisma CLI, seed) cũng nạp .env của máy: đặt rỗng để không bao giờ dùng khóa Zalo thật.
    ZALO_OA_APP_ID: "",
    ZALO_OA_SECRET: "",
    ZALO_OA_ACCESS_TOKEN: "",
    ZALO_OA_REFRESH_TOKEN: "",
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts --force", { env, stdio: "pipe" });
}
