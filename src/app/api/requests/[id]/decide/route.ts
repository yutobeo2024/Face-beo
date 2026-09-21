import { prisma } from "@/lib/db";
import { correctionWorkDate } from "@/lib/attendance-service";
import { assertDatesUnlocked, datesBetween } from "@/lib/payroll-lock-state";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { decideSchema } from "@/lib/validators";
import { canDecideRequest, correctionText, isManagerStep, notifyCorrectionReady, notifyManagerApproved, notifyRequestDecided } from "@/lib/notify";
import { addDays, vnDate } from "@/lib/attendance";
import { recomputeDay } from "@/lib/attendance-service";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { announce } from "@/lib/announce";
import { fmtDT } from "@/lib/notify";
import { OPEN_REQUEST_STATUSES, REQUEST_TYPE_LABEL, type RequestTypeT } from "@/lib/roles";

/**
 * Duyệt / từ chối đơn. Duyệt đơn thuộc ngày đã có log => tính lại trễ/sớm của ngày đó.
 * Phòng duyệt 2 bước (TWO_STEP): trưởng phòng DUYỆT đơn PENDING chỉ là bước 1 → MANAGER_APPROVED (chưa hiệu lực), Nhân sự duyệt
 * bước 2 mới có hiệu lực. Từ chối ở bước nào cũng là quyết định cuối.
 */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "requests.decide");
  const id = await idParam(ctx);
  const body = await parseJson(req, decideSchema);
  const r = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status)) throw badRequest("Đơn không còn ở trạng thái chờ duyệt");
  if (!(await canDecideRequest(u, r))) throw forbidden("Bạn không phải người duyệt đơn này");
  // Tháng đã chốt: chỉ chặn DUYỆT (làm đổi công); từ chối vẫn được để đơn không bị treo mãi.
  if (body.action === "APPROVE") {
    await assertDatesUnlocked(
      r.type === "BO_SUNG_CONG" && r.correctionAt ? [await correctionWorkDate(r.employeeId, r.correctionAt)] : datesBetween(vnDate(r.fromTime), vnDate(new Date(r.toTime.getTime() - 1))),
    );
  }
  const who = await prisma.employee.findUnique({ where: { id: r.employeeId }, select: { code: true, name: true } });
  const typeLabel = REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type;
  const timeDetail = r.type === "BO_SUNG_CONG" ? `Bổ sung ${correctionText(r)}` : `${fmtDT(r.fromTime)} → ${fmtDT(r.toTime)}`;

  // Bước 1 của phòng duyệt 2 bước: ghi ý kiến trưởng phòng, chờ Nhân sự.
  if (body.action === "APPROVE" && (await isManagerStep(u, r))) {
    const upd = await prisma.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "MANAGER_APPROVED", managerApproverId: u.id, managerDecidedAt: new Date(), managerNote: body.note || null },
    });
    if (!upd.count) throw badRequest("Đơn không còn ở trạng thái chờ duyệt");
    const stepped = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    await audit({ actorId: u.id, action: "REQUEST_APPROVE", entity: "LeaveRequest", entityId: id, detail: { employeeId: r.employeeId, type: r.type, note: body.note ?? null, step: "MANAGER" } });
    await notifyManagerApproved(stepped);
    await announce(u, `đã duyệt BƯỚC 1 đơn ${typeLabel} #${r.id} của ${who?.code} — ${who?.name} (chờ Nhân sự duyệt)`, {
      key: `req-mgr:${r.id}`,
      detail: timeDetail,
      reason: body.note,
    });
    return json({ request: stepped, recomputedDays: 0 });
  }

  const status = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
  const upd = await prisma.leaveRequest.updateMany({
    where: { id, status: r.status },
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
    detail: { employeeId: r.employeeId, type: r.type, note: body.note ?? null, recomputedDays: recomputed, ...(r.status === "MANAGER_APPROVED" && { step: "FINAL" }) },
  });
  await notifyRequestDecided(decided);
  if (status === "APPROVED" && r.type === "BO_SUNG_CONG") await notifyCorrectionReady(decided);
  await announce(u, `đã ${status === "APPROVED" ? "DUYỆT" : "TỪ CHỐI"} đơn ${typeLabel} #${r.id} của ${who?.code} — ${who?.name}`, {
    key: `req-decided:${r.id}`,
    detail: timeDetail,
    reason: body.note,
  });
  return json({ request: decided, recomputedDays: recomputed });
});
