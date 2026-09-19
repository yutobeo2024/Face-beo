import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient; __dbReady?: Promise<void> };

export const prisma = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/** Bật WAL + busy_timeout một lần cho mỗi tiến trình (PRD mục 9). */
export function ensureDb(): Promise<void> {
  g.__dbReady ??= (async () => {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  })().catch((e) => {
    g.__dbReady = undefined;
    throw e;
  });
  return g.__dbReady;
}
