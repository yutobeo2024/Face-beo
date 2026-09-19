// Cấu hình Prisma CLI (thay cho khóa "prisma" trong package.json — sẽ bị bỏ ở Prisma 7).
// Khi có file này Prisma không tự nạp .env => nạp bằng Node (không ghi đè biến đã có, vd. DATABASE_URL của test).
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
});
