import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { assertDept } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { executeCorrectionSchema } from "@/lib/validators";
import { recordScan } from "@/lib/attendance-service";
import { canExecuteCorrection, correctionText, fmtDT, notifyCorrectionDone } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";

const MAX_SHIFT_FROM_REQUEST_MS = 12 * 3600_000;

/**
 * Bước 2 của đơn bổ sung công: Nhân sự (hoặc Quản trị cho đơn của Nhân sự) chấm tay theo đơn đã duyệt.
 * Tạo log MANUAL gắn `sourceRequestId`, ghi AuditLog, báo nhân viên và công khai vào nhóm Zalo.
 */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "attendance.executeCorrection");
  const id = await idParam(ctx);
  const body = await parseJson(req, executeCorrectionSchema);
  const r = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: { select: { code: true, name: true, departmentId: true } } } });
  if (!r) throw notFound();
  if (r.type !== "BO_SUNG_CONG" || !r.correctionAt) throw badRequest("Đơn này không phải đơn bổ sung công");
  if (r.status !== "APPROVED") throw badRequest("Đơn chưa được duyệt");
  if (r.executedAt) throw badRequest("Đơn đã được chấm tay trước đó");
  assertDept(u, r.employee.departmentId);
  if (!(await canExecuteCorrection(u, r))) throw forbidden("Bạn không phải người thực hiện chấm tay cho đơn này");

  const checkTime = body.checkTime ?? r.correctionAt;
  if (checkTime.getTime() > Date.now() + 5 * 60_000) throw badRequest("Không thể chấm tay cho thời điểm ở tương lai");
  if (Math.abs(checkTime.getTime() - r.correctionAt.getTime()) > MAX_SHIFT_FROM_REQUEST_MS) {
    throw badRequest("Giờ chấm tay lệch quá 12 giờ so với giờ trong đơn");
  }

  // Giữ chỗ trước (chống 2 người thực hiện cùng lúc), rồi mới tạo log.
  const claimed = await prisma.leaveRequest.updateMany({ where: { id, executedAt: null }, data: { executedAt: new Date(), executedById: u.id } });
  if (!claimed.count) throw badRequest("Đơn đã được chấm tay trước đó");
  try {
    const out = await recordScan({
      employeeId: r.employeeId,
      checkTime,
      source: "MANUAL",
      note: `Bổ sung công theo đơn #${r.id}${body.note ? ` — ${body.note}` : ""}`,
      createdById: u.id,
    });
    if (out.status !== "CREATED") throw badRequest("Không tạo được log chấm công");
    await prisma.attendanceLog.update({ where: { id: out.log.id }, data: { sourceRequestId: r.id } });
    const done = await prisma.leaveRequest.update({ where: { id }, data: { executedLogId: out.log.id } });
    await audit({
      actorId: u.id,
      action: "CORRECTION_EXECUTE",
      entity: "LeaveRequest",
      entityId: id,
      detail: { employeeId: r.employeeId, requested: r.correctionAt.toISOString(), checkTime: checkTime.toISOString(), logId: out.log.id, note: body.note ?? null },
    });
    await notifyCorrectionDone(done, u.name, checkTime);
    const changed = checkTime.getTime() !== r.correctionAt.getTime();
    await announce(u, `đã chấm tay theo đơn bổ sung công #${r.id} cho ${r.employee.code} — ${r.employee.name}`, {
      key: `corr-exec:${r.id}`,
      detail: `Đơn: ${correctionText(r)}${changed ? ` → chấm lúc ${fmtDT(checkTime)}` : ""}`,
      reason: body.note,
    });
    return json({ ok: true, log: out.log });
  } catch (e) {
    // Hoàn tác giữ chỗ nếu tạo log thất bại, để có thể thực hiện lại.
    await prisma.leaveRequest.updateMany({ where: { id, executedLogId: null }, data: { executedAt: null, executedById: null } });
    throw e;
  }
});
