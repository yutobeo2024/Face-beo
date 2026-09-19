import { z } from "zod";
import { prisma } from "@/lib/db";
import { correctionWorkDate } from "@/lib/attendance-service";
import { assertDatesUnlocked, datesBetween } from "@/lib/payroll-lock-state";
import { badRequest, handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere, requireUser } from "@/lib/auth";
import { optId, requestCreateSchema } from "@/lib/validators";
import { addDays, todayVN, vnDate } from "@/lib/attendance";
import { canDecideRequest, canExecuteCorrection, notifyRequestCreated } from "@/lib/notify";
import { REQUEST_STATUSES, REQUEST_TYPES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { withLock } from "@/lib/mutex";

const listQuery = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  departmentId: optId,
  // "execute" = đơn bổ sung công đã duyệt, đang chờ Nhân sự chấm tay
  view: z.enum(["all", "execute"]).default("all"),
});

const MAX_PAST_DAYS = 3;
const CORRECTION_SLOT_MS = 60_000; // đơn bổ sung công lưu như khoảng 1 phút tại giờ cần bổ sung

export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const q = parseQuery(req, listQuery);
  const filters = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.type ? { type: q.type } : {}),
  };
  const decider = await can(u, "requests.decide");
  const executor = await can(u, "attendance.executeCorrection");
  if (q.scope === "mine" || (!decider && !executor)) {
    const rows = await prisma.leaveRequest.findMany({
      where: { employeeId: u.id, ...filters },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { approver: { select: { name: true } } },
    });
    return json({
      requests: rows.map((r) => ({
        ...r,
        canDecide: false,
        canExecute: false,
        canCancel: r.status === "PENDING",
      })),
    });
  }
  const where =
    q.view === "execute"
      ? {
          type: "BO_SUNG_CONG",
          status: "APPROVED",
          executedAt: null,
          employee: employeeScopeWhere(u, q.departmentId),
        }
      : { ...filters, employee: employeeScopeWhere(u, q.departmentId) };
  const rows = await prisma.leaveRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
    include: {
      employee: {
        select: {
          id: true,
          code: true,
          name: true,
          departmentId: true,
          department: { select: { name: true } },
        },
      },
      approver: { select: { name: true } },
    },
  });
  // Quyền duyệt / chấm tay theo tuyến (notify.ts); ghi nhớ theo người tạo đơn để tránh truy vấn lặp.
  const memoDecide = new Map<number, boolean>();
  const memoExec = new Map<number, boolean>();
  const out = [];
  for (const r of rows) {
    let canDecide = false;
    let canExecute = false;
    if (r.status === "PENDING" && decider) {
      if (!memoDecide.has(r.employeeId)) memoDecide.set(r.employeeId, await canDecideRequest(u, r));
      canDecide = memoDecide.get(r.employeeId)!;
    }
    if (r.type === "BO_SUNG_CONG" && r.status === "APPROVED" && !r.executedAt && executor) {
      if (!memoExec.has(r.employeeId)) memoExec.set(r.employeeId, await canExecuteCorrection(u, r));
      canExecute = memoExec.get(r.employeeId)!;
    }
    out.push({ ...r, canDecide, canExecute, canCancel: false });
  }
  return json({ requests: out });
});

export const POST = handle(async (req) => {
  const u = await requireUser(req);
  const body = await parseJson(req, requestCreateSchema);
  const minDate = addDays(todayVN(), -MAX_PAST_DAYS);

  let fromTime: Date;
  let toTime: Date;
  if (body.type === "BO_SUNG_CONG") {
    if (body.correctionAt.getTime() > Date.now() + 5 * 60_000) throw badRequest("Không bổ sung công cho thời điểm ở tương lai");
    if (vnDate(body.correctionAt) < minDate) throw badRequest(`Chỉ bổ sung công trong vòng ${MAX_PAST_DAYS} ngày`);
    fromTime = body.correctionAt;
    toTime = new Date(body.correctionAt.getTime() + CORRECTION_SLOT_MS);
  } else {
    fromTime = body.fromTime;
    toTime = body.toTime;
    if (toTime.getTime() - fromTime.getTime() > 31 * 86_400_000) throw badRequest("Một đơn tối đa 31 ngày");
    if (vnDate(fromTime) < minDate) throw badRequest(`Không tạo đơn cho ngày đã qua quá ${MAX_PAST_DAYS} ngày`);
  }

  await assertDatesUnlocked(
    body.type === "BO_SUNG_CONG" ? [await correctionWorkDate(u.id, fromTime)] : datesBetween(vnDate(fromTime), vnDate(new Date(toTime.getTime() - 1))),
  );

  // Không trùng thời gian với đơn cùng loại đang chờ duyệt hoặc đã duyệt (kiểm tra + ghi tuần tự theo nhân viên).
  const r = await withLock(`request-create:${u.id}`, async () => {
    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: u.id,
        type: body.type,
        status: { in: ["PENDING", "APPROVED"] },
        fromTime: {
          lt: body.type === "BO_SUNG_CONG" ? new Date(toTime.getTime() + 15 * 60_000) : toTime,
        },
        toTime: {
          gt: body.type === "BO_SUNG_CONG" ? new Date(fromTime.getTime() - 15 * 60_000) : fromTime,
        },
      },
    });
    if (overlap) throw badRequest(`Trùng thời gian với đơn #${overlap.id} cùng loại đang chờ duyệt hoặc đã duyệt`);

    return prisma.leaveRequest.create({
      data: {
        employeeId: u.id,
        type: body.type,
        fromTime,
        toTime,
        reason: body.reason,
        ...(body.type === "BO_SUNG_CONG"
          ? {
              correctionAt: body.correctionAt,
              correctionKind: body.correctionKind,
            }
          : {}),
      },
    });
  });
  await notifyRequestCreated(r);
  return json({ request: r }, { status: 201 });
});
