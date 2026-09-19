import { prisma } from "./db";
import { forbidden } from "./api";
import { assertDept, type AuthUser } from "./auth";
import { recomputeDay } from "./attendance-service";
import { todayVN } from "./attendance";

/** Ngày đã qua có log chấm công => khóa với MANAGER. */
export async function lockedCells(employeeIds: number[], dates: string[]) {
  const today = todayVN();
  const past = dates.filter((d) => d < today);
  if (!past.length) return new Set<string>();
  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: employeeIds }, workDate: { in: past } },
    select: { employeeId: true, workDate: true },
    distinct: ["employeeId", "workDate"],
  });
  return new Set(logs.map((l) => `${l.employeeId}|${l.workDate}`));
}

export async function applyCells(
  u: AuthUser,
  cells: { employeeId: number; date: string; shiftId: number | null; isDayOff: boolean; clear?: boolean }[],
) {
  const ids = [...new Set(cells.map((c) => c.employeeId))];
  const emps = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, departmentId: true } });
  const deptOf = new Map(emps.map((e) => [e.id, e.departmentId]));
  for (const c of cells) {
    const d = deptOf.get(c.employeeId);
    if (d == null) throw forbidden("Nhân viên không tồn tại");
    assertDept(u, d);
  }
  const locked = await lockedCells(ids, [...new Set(cells.map((c) => c.date))]);
  const today = todayVN();
  let saved = 0;
  let skipped = 0;
  const recompute = new Set<string>();
  for (const c of cells) {
    const k = `${c.employeeId}|${c.date}`;
    if (locked.has(k) && u.role !== "ADMIN") {
      skipped++;
      continue;
    }
    if (c.clear) {
      await prisma.workSchedule.deleteMany({ where: { employeeId: c.employeeId, date: c.date } });
    } else {
      const data = { shiftId: c.isDayOff ? null : c.shiftId, isDayOff: c.isDayOff || c.shiftId == null };
      await prisma.workSchedule.upsert({
        where: { employeeId_date: { employeeId: c.employeeId, date: c.date } },
        create: { employeeId: c.employeeId, date: c.date, ...data },
        update: data,
      });
    }
    saved++;
    if (c.date <= today) recompute.add(k);
  }
  for (const k of recompute) {
    const [id, d] = k.split("|");
    await recomputeDay(Number(id), d);
  }
  return { saved, skipped };
}
