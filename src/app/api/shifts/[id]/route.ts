import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { shiftSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { breakFitsShift } from "@/lib/attendance";
import { announce, onceKey } from "@/lib/announce";

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, shiftSchema.partial());
  const s = await prisma.shift.findUnique({ where: { id } });
  if (!s) throw notFound();
  const start = body.startTime ?? s.startTime;
  const end = body.endTime ?? s.endTime;
  if (start === end) throw badRequest("Giờ bắt đầu và kết thúc không được trùng nhau");
  if (!breakFitsShift({ ...s, ...body })) throw badRequest("Giờ nghỉ phải nằm trọn trong ca");
  const updated = await prisma.shift.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "SHIFT_UPDATE", entity: "Shift", entityId: id, detail: { before: s, after: updated } });
  if (body.workDayValue !== undefined && body.workDayValue !== s.workDayValue) {
    await announce(u, `đã đổi hệ số công chung của ca "${updated.name}": ${s.workDayValue} → ${updated.workDayValue}`, {
      key: onceKey("shift-weight", id),
      detail: "Áp dụng cho các tháng chưa chốt công",
    });
  }
  return json({ shift: updated });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  // Mẫu tuần và lịch sử phân công không có khóa ngoại tới Shift => phải tự kiểm tra, nếu không ngày làm sẽ âm thầm thành ngày nghỉ.
  const dayRefs = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"].map((k) => ({ [k]: id }));
  const [emps, scheds, logs, patterns, assignments] = await Promise.all([
    prisma.employee.count({ where: { defaultShiftId: id } }),
    prisma.workSchedule.count({ where: { shiftId: id } }),
    prisma.attendanceLog.count({ where: { shiftId: id } }),
    prisma.workPattern.count({ where: { OR: dayRefs } }),
    prisma.scheduleAssignment.count({ where: { OR: [{ defaultShiftId: id }, ...dayRefs] } }),
  ]);
  if (emps + scheds + logs + patterns + assignments > 0) throw badRequest("Ca đang được dùng (nhân viên, mẫu tuần, lịch hoặc log chấm công), không thể xóa");
  await prisma.$transaction([prisma.departmentShiftWeight.deleteMany({ where: { shiftId: id } }), prisma.shift.delete({ where: { id } })]);
  await audit({ actorId: u.id, action: "SHIFT_UPDATE", entity: "Shift", entityId: id, detail: { deleted: true } });
  return json({ ok: true });
});
