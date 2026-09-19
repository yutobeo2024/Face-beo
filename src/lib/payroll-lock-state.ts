/**
 * Trạng thái chốt công tháng (không phụ thuộc attendance-service để tránh import vòng).
 * Tháng đã chốt: kết quả công lấy từ bản chụp LockedDay; mọi thao tác ghi làm đổi công bị chặn (409).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./api";

type Db = Prisma.TransactionClient | typeof prisma;

const g = globalThis as unknown as { __payrollLocked?: Set<string> | null; __payrollGen?: number };

export const monthOf = (date: string) => date.slice(0, 7);

/** Tập các tháng "YYYY-MM" đã chốt (cache trong tiến trình; xóa khi chốt / mở khóa). */
export async function lockedMonths(db: Db = prisma): Promise<Set<string>> {
  if (g.__payrollLocked) return g.__payrollLocked;
  const gen = g.__payrollGen ?? 0;
  const set = new Set((await db.payrollLock.findMany({ select: { month: true } })).map((r) => r.month));
  if ((g.__payrollGen ?? 0) === gen) g.__payrollLocked = set;
  return set;
}

export function invalidatePayrollLockCache() {
  g.__payrollGen = (g.__payrollGen ?? 0) + 1;
  g.__payrollLocked = null;
}

export const fmtMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Lỗi 409 nếu có ngày nào thuộc tháng đã chốt công. */
export async function assertDatesUnlocked(dates: string[], db: Db = prisma) {
  if (!dates.length) return;
  const locked = await lockedMonths(db);
  if (!locked.size) return;
  const hit = [...new Set(dates.map(monthOf))].filter((m) => locked.has(m)).sort();
  if (hit.length) throw new HttpError(409, `Tháng ${hit.map(fmtMonth).join(", ")} đã chốt công — liên hệ Quản trị để mở khóa`);
}

/** Mọi ngày YYYY-MM-DD trong [from, to]. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** JSON.parse khôi phục các trường Date (chuỗi ISO đầy đủ). */
export const reviveSnapshot = <T>(data: string): T => JSON.parse(data, (_k, v) => (typeof v === "string" && ISO_DT.test(v) ? new Date(v) : v)) as T;
