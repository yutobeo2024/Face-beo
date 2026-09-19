import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { copyWeekSchema } from "@/lib/validators";
import { addDays, startOfWeek } from "@/lib/attendance";
import { applyCells } from "@/lib/roster";

/** Sao chép lịch nhóm xoay ca của tuần nguồn sang tuần đích (tuần đích phải còn sửa được với người dùng). */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "roster.edit");
  const body = await parseJson(req, copyWeekSchema);
  const from = startOfWeek(body.fromWeek);
  const to = startOfWeek(body.toWeek);
  if (from === to) throw badRequest("Tuần nguồn và tuần đích trùng nhau");
  const emps = await prisma.employee.findMany({
    where: {
      ...employeeScopeWhere(u, body.departmentId),
      active: true,
      scheduleType: "ROTATING",
      ...(body.employeeIds ? { id: { in: body.employeeIds } } : {}),
    },
    select: { id: true },
  });
  const src = await prisma.workSchedule.findMany({
    where: { employeeId: { in: emps.map((e) => e.id) }, date: { gte: from, lte: addDays(from, 6) } },
  });
  if (!src.length) return json({ saved: 0, changed: 0, message: "Tuần nguồn không có lịch xoay ca" });
  const offsetDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  const result = await applyCells(
    u,
    src.map((s) => ({ employeeId: s.employeeId, date: addDays(s.date, offsetDays), shiftId: s.shiftId, isDayOff: s.isDayOff })),
    body.reason,
  );
  return json(result);
});
