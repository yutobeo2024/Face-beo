/**
 * Chốt công tháng (D2): HR/Quản trị chốt tháng đã kết thúc → chụp kết quả công từng ngày (LockedDay);
 * chỉ Quản trị mở khóa, bắt buộc lý do. Mọi thao tác có nhật ký và tin nhóm Zalo.
 */
import { DateTime } from "luxon";
import { prisma } from "./db";
import { badRequest } from "./api";
import type { AuthUser } from "./auth";
import { TZ, todayVN } from "./attendance";
import { summarizeRange } from "./attendance-service";
import { audit } from "./audit";
import { announce } from "./announce";
import { withLock } from "./mutex";
import { fmtMonth, invalidatePayrollLockCache } from "./payroll-lock-state";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthRange(month: string) {
  const start = DateTime.fromISO(`${month}-01`, { zone: TZ });
  return { from: start.toISODate()!, to: start.endOf("month").toISODate()! };
}

/** Ngày sớm nhất được chốt tháng: ngày 2 của tháng sau (ca đêm ngày cuối tháng kịp chấm ra). */
export const earliestLockDate = (month: string) => DateTime.fromISO(`${month}-01`, { zone: TZ }).plus({ months: 1, days: 1 }).toISODate()!;

export type LockTotals = { employees: number; workDays: number; leaveDays: number; otMinutes: number; absentDays: number };

export async function lockMonth(u: AuthUser, month: string) {
  if (!MONTH_RE.test(month)) throw badRequest("Tháng không hợp lệ (YYYY-MM)");
  if (todayVN() < earliestLockDate(month)) throw badRequest(`Tháng ${fmtMonth(month)} chưa kết thúc — chốt được từ ngày ${earliestLockDate(month).split("-").reverse().join("/")}`);
  return withLock("payroll", async () => {
    if (await prisma.payrollLock.findUnique({ where: { month } })) throw badRequest(`Tháng ${fmtMonth(month)} đã được chốt`);
    const { from, to } = monthRange(month);
    // Nhân viên đang làm + người đã nghỉ việc nhưng có log trong tháng.
    const emps = await prisma.employee.findMany({
      where: { OR: [{ active: true }, { logs: { some: { workDate: { gte: from, lte: to } } } }] },
      select: { id: true },
    });
    const ids = emps.map((e) => e.id);
    const { summaries } = await summarizeRange(ids, from, to);
    const totals: LockTotals = { employees: ids.length, workDays: 0, leaveDays: 0, otMinutes: 0, absentDays: 0 };
    const rows = [...summaries.entries()].map(([k, s]) => {
      const [employeeId, workDate] = k.split("|");
      totals.workDays += s.workDayUnits;
      totals.leaveDays += s.leaveDayUnits;
      totals.otMinutes += s.otMinutes;
      if (s.status === "ABSENT") totals.absentDays++;
      return { employeeId: Number(employeeId), workDate, month, data: JSON.stringify(s) };
    });
    totals.workDays = Math.round(totals.workDays * 100) / 100;
    totals.leaveDays = Math.round(totals.leaveDays * 100) / 100;
    await prisma.$transaction(async (tx) => {
      await tx.lockedDay.deleteMany({ where: { month } });
      for (let i = 0; i < rows.length; i += 500) await tx.lockedDay.createMany({ data: rows.slice(i, i + 500) });
      await tx.payrollLock.create({ data: { month, lockedById: u.id, totals: JSON.stringify(totals) } });
    });
    invalidatePayrollLockCache();
    await audit({ actorId: u.id, action: "PAYROLL_LOCK", entity: "PayrollLock", entityId: month, detail: totals });
    await announce(u, `đã CHỐT CÔNG tháng ${fmtMonth(month)}`, {
      key: `payroll-lock:${month}:${Date.now()}`,
      detail: `${totals.employees} nhân viên · ${totals.workDays} ngày công · ${totals.leaveDays} ngày phép · ${Math.round((totals.otMinutes / 60) * 10) / 10} giờ OT`,
      always: true,
    });
    return totals;
  });
}

export async function unlockMonth(u: AuthUser, month: string, reason: string) {
  if (!MONTH_RE.test(month)) throw badRequest("Tháng không hợp lệ (YYYY-MM)");
  if (reason.trim().length < 5) throw badRequest("Mở khóa bắt buộc nhập lý do (tối thiểu 5 ký tự)");
  return withLock("payroll", async () => {
    const lock = await prisma.payrollLock.findUnique({ where: { month } });
    if (!lock) throw badRequest(`Tháng ${fmtMonth(month)} chưa được chốt`);
    await prisma.$transaction([prisma.lockedDay.deleteMany({ where: { month } }), prisma.payrollLock.delete({ where: { month } })]);
    invalidatePayrollLockCache();
    await audit({ actorId: u.id, action: "PAYROLL_UNLOCK", entity: "PayrollLock", entityId: month, detail: { reason, lockedAt: lock.lockedAt, totals: lock.totals } });
    await announce(u, `đã MỞ KHÓA công tháng ${fmtMonth(month)}`, { key: `payroll-unlock:${month}:${Date.now()}`, reason, always: true });
    return { ok: true };
  });
}

/** Trạng thái chốt của N tháng gần nhất (tháng trước trở về). */
export async function recentMonths(n = 6) {
  const cur = DateTime.fromISO(todayVN(), { zone: TZ }).startOf("month");
  const months = Array.from({ length: n }, (_, i) => cur.minus({ months: i + 1 }).toFormat("yyyy-MM"));
  const locks = await prisma.payrollLock.findMany({ where: { month: { in: months } } });
  const lockers = new Map(
    (await prisma.employee.findMany({ where: { id: { in: locks.map((l) => l.lockedById) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
  );
  const today = todayVN();
  return months.map((month) => {
    const l = locks.find((x) => x.month === month);
    return {
      month,
      locked: !!l,
      lockedAt: l?.lockedAt ?? null,
      lockedBy: l ? (lockers.get(l.lockedById) ?? null) : null,
      totals: l?.totals ? (JSON.parse(l.totals) as LockTotals) : null,
      canLockFrom: earliestLockDate(month),
      lockable: !l && today >= earliestLockDate(month),
    };
  });
}
