import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { assertDept } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { executeCorrectionSchema } from "@/lib/validators";
import { recordScan } from "@/lib/attendance-service";
import { vnDate } from "@/lib/attendance";
import { canExecuteCorrection, correctionText, fmtDT, notifyCorrectionDone } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { MAX_EXECUTE_AGE_DAYS } from "@/lib/jobs";

/** Nhân sự chỉ được chỉnh giờ trong đơn tối đa 60 phút, cùng ngày, và phải ghi chú lý do. */
const MAX_ADJUST_MS = 60 * 60_000;

/**
 * Bước 2 của đơn bổ sung công: Nhân sự (hoặc Quản trị cho đơn của Nhân sự) chấm tay theo đơn đã duyệt.
 * Toàn bộ (giữ chỗ đơn, tạo log MANUAL gắn đơn, tính lại ngày công) chạy trong MỘT transaction:
 * lỗi ở bất kỳ bước nào => không để lại log thừa, đơn vẫn ở trạng thái "chờ chấm tay".
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
  if (Date.now() - r.correctionAt.getTime() > MAX_EXECUTE_AGE_DAYS * 86_400_000) {
    throw badRequest(`Đơn quá ${MAX_EXECUTE_AGE_DAYS} ngày, không thể chấm tay — liên hệ Quản trị`);
  }

  const requested = r.correctionAt;
  const checkTime = body.checkTime ?? requested;
  const adjusted = checkTime.getTime() !== requested.getTime();
  if (checkTime.getTime() > Date.now() + 5 * 60_000) throw badRequest("Không thể chấm tay cho thời điểm ở tương lai");
  if (adjusted) {
    if (Math.abs(checkTime.getTime() - requested.getTime()) > MAX_ADJUST_MS) throw badRequest("Chỉ được chỉnh giờ tối đa 60 phút so với giờ trong đơn");
    if (vnDate(checkTime) !== vnDate(requested)) throw badRequest("Giờ chấm tay phải cùng ngày với giờ trong đơn");
    if ((body.note ?? "").trim().length < 5) throw badRequest("Chỉnh giờ so với đơn thì bắt buộc ghi chú lý do (tối thiểu 5 ký tự)");
  }

  const log = await prisma.$transaction(async (tx) => {
    // Giữ chỗ (chống 2 người thực hiện cùng lúc).
    const claimed = await tx.leaveRequest.updateMany({ where: { id, executedAt: null }, data: { executedAt: new Date(), executedById: u.id } });
    if (!claimed.count) throw badRequest("Đơn đã được chấm tay trước đó");
    const out = await recordScan(
      {
        employeeId: r.employeeId,
        checkTime,
        source: "MANUAL",
        note: `Bổ sung công theo đơn #${r.id}${body.note ? ` — ${body.note}` : ""}`,
        createdById: u.id,
        sourceRequestId: r.id,
      },
      tx,
    );
    if (out.status !== "CREATED") throw badRequest("Không tạo được log chấm công");
    // Log tạo ra phải đúng loại nhân viên xin bổ sung (vào/ra); nếu không => hủy toàn bộ.
    if (out.log.type !== r.correctionKind) {
      const got = out.log.type === "IN" ? "VÀO" : "RA";
      const want = r.correctionKind === "IN" ? "vào" : "ra";
      throw badRequest(`Giờ này tạo ra lần chấm ${got}, không khớp loại đơn (quên chấm ${want}). Kiểm tra lại giờ hoặc log hiện có của ngày đó.`);
    }
    await tx.leaveRequest.update({ where: { id }, data: { executedLogId: out.log.id } });
    return out.log;
  });

  const done = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  await audit({
    actorId: u.id,
    action: "CORRECTION_EXECUTE",
    entity: "LeaveRequest",
    entityId: id,
    detail: { employeeId: r.employeeId, requested: requested.toISOString(), checkTime: checkTime.toISOString(), logId: log.id, note: body.note ?? null },
  });
  await notifyCorrectionDone(done, u.name, checkTime);
  await announce(u, `đã chấm tay theo đơn bổ sung công #${r.id} cho ${r.employee.code} — ${r.employee.name}`, {
    key: `corr-exec:${r.id}`,
    detail: `Đơn: ${correctionText(r)}${adjusted ? ` → chấm lúc ${fmtDT(checkTime)}` : ""}`,
    reason: body.note,
  });
  return json({ ok: true, log });
});
