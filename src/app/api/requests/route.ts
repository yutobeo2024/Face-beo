import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere, requireUser } from "@/lib/auth";
import { optId, requestCreateSchema } from "@/lib/validators";
import { addDays, todayVN, vnDate } from "@/lib/attendance";
import { approversFor, notifyRequestCreated } from "@/lib/notify";
import { REQUEST_STATUSES, REQUEST_TYPES } from "@/lib/roles";

const listQuery = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  departmentId: optId,
});

export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const q = parseQuery(req, listQuery);
  const filters = { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) };
  if (q.scope === "mine" || u.role === "EMPLOYEE") {
    const rows = await prisma.leaveRequest.findMany({
      where: { employeeId: u.id, ...filters },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { approver: { select: { name: true } } },
    });
    return json({ requests: rows.map((r) => ({ ...r, canDecide: false, canCancel: r.status === "PENDING" })) });
  }
  const rows = await prisma.leaveRequest.findMany({
    where: { ...filters, employee: employeeScopeWhere(u, q.departmentId) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
    include: {
      employee: { select: { id: true, code: true, name: true, departmentId: true, department: { select: { name: true } } } },
      approver: { select: { name: true } },
    },
  });
  // Đơn của chính MANAGER chuyển cho ADMIN; ADMIN duyệt được mọi đơn trừ đơn của chính mình.
  const routed = new Map<number, number[]>();
  const out = [];
  for (const r of rows) {
    let canDecide = r.status === "PENDING" && r.employeeId !== u.id;
    if (canDecide && u.role === "MANAGER") {
      if (!routed.has(r.employeeId)) routed.set(r.employeeId, await approversFor(r.employeeId));
      canDecide = routed.get(r.employeeId)!.includes(u.id);
    }
    out.push({ ...r, canDecide, canCancel: false });
  }
  return json({ requests: out });
});

export const POST = handle(async (req) => {
  const u = await requireUser(req);
  const body = await parseJson(req, requestCreateSchema);
  if (body.toTime.getTime() - body.fromTime.getTime() > 31 * 86_400_000) throw badRequest("Một đơn tối đa 31 ngày");
  if (vnDate(body.fromTime) < addDays(todayVN(), -3)) {
    throw badRequest("Không tạo đơn cho ngày đã qua quá 3 ngày");
  }
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: u.id,
      type: body.type,
      status: { in: ["PENDING", "APPROVED"] },
      fromTime: { lt: body.toTime },
      toTime: { gt: body.fromTime },
    },
  });
  if (overlap) throw badRequest(`Trùng thời gian với đơn #${overlap.id} cùng loại đang chờ duyệt hoặc đã duyệt`);
  const r = await prisma.leaveRequest.create({
    data: { employeeId: u.id, type: body.type, fromTime: body.fromTime, toTime: body.toTime, reason: body.reason },
  });
  await notifyRequestCreated(r);
  return json({ request: r }, { status: 201 });
});
