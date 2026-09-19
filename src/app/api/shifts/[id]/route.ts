import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { shiftSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const body = await parseJson(req, shiftSchema.partial());
  const s = await prisma.shift.findUnique({ where: { id } });
  if (!s) throw notFound();
  const start = body.startTime ?? s.startTime;
  const end = body.endTime ?? s.endTime;
  if (start === end) throw badRequest("Giờ bắt đầu và kết thúc không được trùng nhau");
  const updated = await prisma.shift.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "SHIFT_UPDATE", entity: "Shift", entityId: id, detail: { before: s, after: updated } });
  return json({ shift: updated });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const [emps, scheds, logs] = await Promise.all([
    prisma.employee.count({ where: { defaultShiftId: id } }),
    prisma.workSchedule.count({ where: { shiftId: id } }),
    prisma.attendanceLog.count({ where: { shiftId: id } }),
  ]);
  if (emps + scheds + logs > 0) throw badRequest("Ca đang được dùng (nhân viên, lịch hoặc log chấm công), không thể xóa");
  await prisma.shift.delete({ where: { id } });
  await audit({ actorId: u.id, action: "SHIFT_UPDATE", entity: "Shift", entityId: id, detail: { deleted: true } });
  return json({ ok: true });
});
