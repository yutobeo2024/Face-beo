// Tạo DB test sạch + seed một lần trước toàn bộ test tích hợp.
import { execSync } from "node:child_process";

export default function setup() {
  if (process.env.SKIP_DB_SETUP === "1") return;
  const env = {
    ...process.env,
    DATABASE_URL: "file:../data/test.db",
    BIOMETRIC_KEY: "11".repeat(32),
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
