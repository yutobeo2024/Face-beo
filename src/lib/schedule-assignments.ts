/**
 * Lịch sử phân công lịch làm việc có hiệu lực theo ngày (ScheduleAssignment).
 * Đổi mẫu tuần / loại lịch / phòng ban / ca mặc định chỉ áp dụng từ ngày hiệu lực trở đi — công các ngày đã qua giữ nguyên.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { todayVN } from "./attendance";
import { recomputeDay } from "./attendance-service";

type Db = Prisma.TransactionClient | typeof prisma;

/** Ngày hiệu lực dùng cho bản ghi gốc (áp dụng cho mọi ngày trước bản ghi đầu tiên). */
export const BASELINE_DATE = "2000-01-01";

/** Chụp cấu hình lịch hiện tại của nhân viên (kèm ca theo thứ của mẫu tuần) thành bản ghi có hiệu lực từ `effectiveFrom`. */
export async function snapshotAssignment(employeeId: number, effectiveFrom: string, db: Db = prisma) {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { workPattern: true } });
  const p = e.workPattern;
  const data = {
    scheduleType: e.scheduleType,
    departmentId: e.departmentId,
    defaultShiftId: e.defaultShiftId,
    workPatternId: e.workPatternId,
    monShiftId: p?.monShiftId ?? null,
    tueShiftId: p?.tueShiftId ?? null,
    wedShiftId: p?.wedShiftId ?? null,
    thuShiftId: p?.thuShiftId ?? null,
    friShiftId: p?.friShiftId ?? null,
    satShiftId: p?.satShiftId ?? null,
    sunShiftId: p?.sunShiftId ?? null,
  };
  await db.scheduleAssignment.upsert({
    where: { employeeId_effectiveFrom: { employeeId, effectiveFrom } },
    create: { employeeId, effectiveFrom, ...data },
    update: data,
  });
}

/** Gọi TRƯỚC khi đổi cấu hình: nhân viên chưa có lịch sử thì chụp cấu hình hiện tại làm bản gốc (áp dụng cho quá khứ). */
export async function ensureBaseline(employeeIds: number[]) {
  const has = new Set((await prisma.scheduleAssignment.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true }, distinct: ["employeeId"] })).map((x) => x.employeeId));
  for (const id of employeeIds) if (!has.has(id)) await snapshotAssignment(id, BASELINE_DATE);
}

/** Áp dụng thay đổi cấu hình lịch từ hôm nay: ghi bản ghi mới rồi tính lại công hôm nay. */
export async function applyScheduleChangeFromToday(employeeIds: number[]) {
  const today = todayVN();
  for (const id of employeeIds) {
    await snapshotAssignment(id, today);
    await recomputeDay(id, today);
  }
}
