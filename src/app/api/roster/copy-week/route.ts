import { prisma } from "@/lib/db";
import { TRACKED_WHERE } from "@/lib/attendance-scope";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { copyWeekSchema } from "@/lib/validators";
import { addDays, startOfWeek, weekDates } from "@/lib/attendance";
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
      // Dùng AND: bộ lọc phạm vi có thể là { id: -1 } — không để employeeIds ghi đè lên nó.
      AND: [employeeScopeWhere(u, body.departmentId), body.employeeIds ? { id: { in: body.employeeIds } } : {}, TRACKED_WHERE],
      active: true,
      scheduleType: "ROTATING",
    },
    select: { id: true },
  });
  const src = await prisma.workSchedule.findMany({
    where: { employeeId: { in: emps.map((e) => e.id) }, date: { gte: from, lte: addDays(from, 6) } },
  });
  if (!src.length) throw badRequest("Tuần nguồn không có lịch xoay ca để sao chép");
  const offsetDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  // Sao chép = thay thế: ngày ở tuần đích không có ô tương ứng ở tuần nguồn thì xóa ô cũ (cho nhân viên có lịch ở tuần nguồn).
  const srcKey = new Set(src.map((s) => `${s.employeeId}|${addDays(s.date, offsetDays)}`));
  const clears = [...new Set(src.map((s) => s.employeeId))].flatMap((employeeId) =>
    weekDates(to)
      .filter((date) => !srcKey.has(`${employeeId}|${date}`))
      .map((date) => ({ employeeId, date, shiftId: null, isDayOff: false, clear: true })),
  );
  const result = await applyCells(
    u,
    [...src.map((s) => ({ employeeId: s.employeeId, date: addDays(s.date, offsetDays), shiftId: s.shiftId, isDayOff: s.isDayOff })), ...clears],
    body.reason,
  );
  return json(result);
});
