import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { decideSchema } from "@/lib/validators";
import { canDecideRequest, correctionText, notifyCorrectionReady, notifyRequestDecided } from "@/lib/notify";
import { addDays, vnDate } from "@/lib/attendance";
import { recomputeDay } from "@/lib/attendance-service";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { announce } from "@/lib/announce";
import { fmtDT } from "@/lib/notify";
import { REQUEST_TYPE_LABEL, type RequestTypeT } from "@/lib/roles";

/** Duyệt / từ chối đơn. Duyệt đơn thuộc ngày đã có log => tính lại trễ/sớm của ngày đó. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "requests.decide");
  const id = await idParam(ctx);
  const body = await parseJson(req, decideSchema);
  const r = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (!(await canDecideRequest(u, r))) throw forbidden("Bạn không phải người duyệt đơn này");
  const status = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
  const upd = await prisma.leaveRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status, approverId: u.id, decidedAt: new Date(), decisionNote: body.note || null },
  });
  if (!upd.count) throw badRequest("Đơn không còn ở trạng thái chờ duyệt");
  const decided = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });

  let recomputed = 0;
  // Đơn bổ sung công chưa ảnh hưởng công cho tới khi Nhân sự chấm tay (bước 2).
  if (status === "APPROVED" && r.type !== "BO_SUNG_CONG") {
    const days = await prisma.attendanceLog.findMany({
      where: { employeeId: r.employeeId, workDate: { gte: addDays(vnDate(r.fromTime), -1), lte: vnDate(r.toTime) } },
      select: { workDate: true },
      distinct: ["workDate"],
    });
    for (const d of days) {
      await recomputeDay(r.employeeId, d.workDate);
      recomputed++;
    }
  }
  await audit({
    actorId: u.id,
    action: status === "APPROVED" ? "REQUEST_APPROVE" : "REQUEST_REJECT",
    entity: "LeaveRequest",
    entityId: id,
    detail: { employeeId: r.employeeId, type: r.type, note: body.note ?? null, recomputedDays: recomputed },
  });
  await notifyRequestDecided(decided);
  if (status === "APPROVED" && r.type === "BO_SUNG_CONG") await notifyCorrectionReady(decided);
  const who = await prisma.employee.findUnique({ where: { id: r.employeeId }, select: { code: true, name: true } });
  await announce(
    u,
    `đã ${status === "APPROVED" ? "DUYỆT" : "TỪ CHỐI"} đơn ${REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type} #${r.id} của ${who?.code} — ${who?.name}`,
    { key: `req-decided:${r.id}`, detail: r.type === "BO_SUNG_CONG" ? `Bổ sung ${correctionText(r)}` : `${fmtDT(r.fromTime)} → ${fmtDT(r.toTime)}`, reason: body.note },
  );
  return json({ request: decided, recomputedDays: recomputed });
});
