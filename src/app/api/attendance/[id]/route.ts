import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { recomputeDay } from "@/lib/attendance-service";
import { audit } from "@/lib/audit";

/** ADMIN xóa một log sai (kèm lý do), rồi tính lại ngày công. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().min(5).max(300) }));
  const log = await prisma.attendanceLog.findUnique({ where: { id } });
  if (!log) throw notFound();
  await prisma.attendanceLog.delete({ where: { id } });
  await recomputeDay(log.employeeId, log.workDate);
  await audit({
    actorId: u.id,
    action: "ATTENDANCE_DELETE",
    entity: "AttendanceLog",
    entityId: id,
    detail: { employeeId: log.employeeId, workDate: log.workDate, checkTime: log.checkTime.toISOString(), source: log.source, reason },
  });
  return json({ ok: true });
});
