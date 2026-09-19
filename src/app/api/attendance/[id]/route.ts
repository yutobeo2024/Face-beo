import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertDatesUnlocked } from "@/lib/payroll-lock-state";
import { forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { assertDept } from "@/lib/auth";
import { recomputeDay } from "@/lib/attendance-service";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

/** ADMIN xóa một log sai (kèm lý do), rồi tính lại ngày công. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "attendance.delete");
  const id = await idParam(ctx);
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().min(5).max(300) }));
  const log = await prisma.attendanceLog.findUnique({ where: { id }, include: { employee: { select: { departmentId: true } } } });
  if (!log) throw notFound();
  assertDept(u, log.employee.departmentId);
  if (log.employeeId === u.id && u.role !== "ADMIN") throw forbidden("Không thể tự xóa log chấm công của chính mình");
  await assertDatesUnlocked([log.workDate]);
  await prisma.attendanceLog.delete({ where: { id } });
  if (log.sourceRequestId) {
    await prisma.leaveRequest.updateMany({
      where: { id: log.sourceRequestId, executedLogId: id },
      data: { executedAt: null, executedById: null, executedLogId: null },
    });
  }
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
