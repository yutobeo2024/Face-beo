/**
 * Chốt công tháng (D2): HR/Quản trị chốt tháng đã kết thúc → chụp kết quả công từng ngày (LockedDay);
 * chỉ Quản trị mở khóa, bắt buộc lý do. Mọi thao tác có nhật ký và tin nhóm Zalo.
 */
import { DateTime } from "luxon";
import { prisma } from "./db";
import { badRequest, forbidden } from "./api";
import { deptScope, type AuthUser } from "./auth";
import { TZ, todayVN } from "./attendance";
import { recomputeDay, summarizeRange } from "./attendance-service";
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
  // Chốt công áp dụng cho toàn công ty => chỉ người có phạm vi toàn công ty (HR / Quản trị).
  if (deptScope(u) !== null) throw forbidden("Chốt công áp dụng toàn công ty — chỉ Nhân sự / Quản trị");
  if (!MONTH_RE.test(month)) throw badRequest("Tháng không hợp lệ (YYYY-MM)");
  if (todayVN() < earliestLockDate(month))
    throw badRequest(`Tháng ${fmtMonth(month)} chưa kết thúc — chốt được từ ngày ${earliestLockDate(month).split("-").reverse().join("/")}`);
  return withLock("payroll", async () => {
    if (await prisma.payrollLock.findUnique({ where: { month } })) throw badRequest(`Tháng ${fmtMonth(month)} đã được chốt`);
    const { from, to } = monthRange(month);
    // Đánh dấu khóa TRƯỚC khi chụp: mọi thao tác ghi vào tháng này bị chặn ngay từ đây (không lọt khỏi bản chụp).
    await prisma.payrollLock.create({ data: { month, lockedById: u.id } });
    invalidatePayrollLockCache();
    try {
      return await snapshotMonth(u, month, from, to);
    } catch (e) {
      await prisma.lockedDay.deleteMany({ where: { month } });
      await prisma.payrollLock.deleteMany({ where: { month } });
      invalidatePayrollLockCache();
      throw e;
    }
  });
}

async function snapshotMonth(u: AuthUser, month: string, from: string, to: string) {
  // Nhân viên đang làm + người đã nghỉ việc nhưng có log trong tháng.
  const emps = await prisma.employee.findMany({
    where: {
      OR: [{ active: true }, { logs: { some: { workDate: { gte: from, lte: to } } } }, { leftAt: { gte: DateTime.fromISO(from, { zone: TZ }).toJSDate() } }],
    },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  const { summaries } = await summarizeRange(ids, from, to, new Date(), { ignoreLocks: true });
  const totals: LockTotals = { employees: ids.length, workDays: 0, leaveDays: 0, otMinutes: 0, absentDays: 0 };
  const rows = [...summaries.entries()].map(([k, s]) => {
    const [employeeId, workDate] = k.split("|");
    totals.workDays += s.workDayUnits;
    totals.leaveDays += s.leaveDayUnits;
    totals.otMinutes += s.otMinutes;
    if (s.status === "ABSENT") totals.absentDays++;
    const { departmentId, ...rest } = s;
    return { employeeId: Number(employeeId), workDate, month, departmentId: departmentId ?? null, data: JSON.stringify(rest) };
  });
  totals.workDays = Math.round(totals.workDays * 100) / 100;
  totals.leaveDays = Math.round(totals.leaveDays * 100) / 100;
  await prisma.$transaction(async (tx) => {
    await tx.lockedDay.deleteMany({ where: { month } });
    for (let i = 0; i < rows.length; i += 500) await tx.lockedDay.createMany({ data: rows.slice(i, i + 500) });
    await tx.payrollLock.update({ where: { month }, data: { totals: JSON.stringify(totals), lockedAt: new Date() } });
  });
  await audit({ actorId: u.id, action: "PAYROLL_LOCK", entity: "PayrollLock", entityId: month, detail: totals });
  await announce(u, `đã CHỐT CÔNG tháng ${fmtMonth(month)}`, {
    key: `payroll-lock:${month}:${Date.now()}`,
    detail: `${totals.employees} nhân viên · ${totals.workDays} ngày công · ${totals.leaveDays} ngày phép · ${Math.round((totals.otMinutes / 60) * 10) / 10} giờ OT`,
    always: true,
  });
  return totals;
}

export async function unlockMonth(u: AuthUser, month: string, reason: string) {
  if (!MONTH_RE.test(month)) throw badRequest("Tháng không hợp lệ (YYYY-MM)");
  if (reason.trim().length < 5) throw badRequest("Mở khóa bắt buộc nhập lý do (tối thiểu 5 ký tự)");
  return withLock("payroll", async () => {
    const lock = await prisma.payrollLock.findUnique({ where: { month } });
    if (!lock) throw badRequest(`Tháng ${fmtMonth(month)} chưa được chốt`);
    await prisma.$transaction([prisma.lockedDay.deleteMany({ where: { month } }), prisma.payrollLock.delete({ where: { month } })]);
    invalidatePayrollLockCache();
    // Trong lúc khóa, log của tháng không được tính lại => tính lại các ngày có log theo dữ liệu hiện tại.
    const { from, to } = monthRange(month);
    const days = await prisma.attendanceLog.findMany({
      where: { workDate: { gte: from, lte: to } },
      select: { employeeId: true, workDate: true },
      distinct: ["employeeId", "workDate"],
    });
    for (const d of days) await recomputeDay(d.employeeId, d.workDate);
    await audit({
      actorId: u.id,
      action: "PAYROLL_UNLOCK",
      entity: "PayrollLock",
      entityId: month,
      detail: { reason, lockedAt: lock.lockedAt, totals: lock.totals },
    });
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
  const pending = new Map<string, number>();
  for (const month of months) {
    const { from, to } = monthRange(month);
    const start = DateTime.fromISO(from, { zone: TZ }).toJSDate();
    const end = DateTime.fromISO(to, { zone: TZ }).plus({ days: 1 }).toJSDate();
    // Đơn còn treo trong tháng (chờ duyệt, hoặc bổ sung công đã duyệt chưa chấm tay) — cảnh báo trước khi chốt.
    pending.set(
      month,
      await prisma.leaveRequest.count({
        where: {
          fromTime: { lt: end },
          toTime: { gt: start },
          OR: [{ status: "PENDING" }, { type: "BO_SUNG_CONG", status: "APPROVED", executedAt: null }],
        },
      }),
    );
  }
  return months.map((month) => {
    const l = locks.find((x) => x.month === month);
    return {
      pendingRequests: pending.get(month) ?? 0,
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
