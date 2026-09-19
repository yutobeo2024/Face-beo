import { prisma } from "@/lib/db";
import { badRequest, handle, json, notFound, parseJson } from "@/lib/api";
import { manualLogSchema } from "@/lib/validators";
import { recordScan } from "@/lib/attendance-service";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

/** ADMIN bổ sung log MANUAL kèm lý do (vd. thiếu giờ ra, nhân viên chưa enroll). */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "attendance.manualDirect");
  const body = await parseJson(req, manualLogSchema);
  const e = await prisma.employee.findUnique({ where: { id: body.employeeId } });
  if (!e) throw notFound("Không tìm thấy nhân viên");
  if (body.checkTime.getTime() > Date.now() + 5 * 60_000) throw badRequest("Không thể thêm log ở tương lai");
  const r = await recordScan({
    employeeId: body.employeeId,
    checkTime: body.checkTime,
    source: "MANUAL",
    note: body.reason,
    createdById: u.id,
  });
  if (r.status !== "CREATED") throw badRequest("Không tạo được log");
  await audit({
    actorId: u.id,
    action: "ATTENDANCE_MANUAL",
    entity: "AttendanceLog",
    entityId: r.log.id,
    detail: { employeeId: body.employeeId, checkTime: body.checkTime.toISOString(), reason: body.reason, workDate: r.log.workDate },
  });
  return json({ log: r.log }, { status: 201 });
});
