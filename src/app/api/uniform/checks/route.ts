import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { UNIFORM_REASON_LABEL, type UniformReason } from "@/lib/uniform-score";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(["PASS", "FAIL", "REVIEW", "SKIPPED"]).optional(),
  mode: z.enum(["ON", "SHADOW"]).optional(),
});

/** GET /api/uniform/checks?from&to&departmentId&status&mode — bảng theo dõi, tối đa 31 ngày. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "uniform.view");
  const q = parseQuery(req, querySchema);
  if (q.to < q.from) throw badRequest("Khoảng ngày không hợp lệ");
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 31) throw badRequest("Tối đa 31 ngày");

  // Giới hạn theo phạm vi phòng của người xem: Quản lý chỉ thấy phòng mình.
  const employees = await prisma.employee.findMany({ where: employeeScopeWhere(u, q.departmentId), select: { id: true, code: true, name: true, departmentId: true, department: { select: { name: true } } } });
  const byId = new Map(employees.map((e) => [e.id, e]));

  const rows = await prisma.uniformCheck.findMany({
    where: {
      employeeId: { in: [...byId.keys()] },
      workDate: { gte: q.from, lte: q.to },
      ...(q.status ? { status: q.status } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
    },
    orderBy: [{ workDate: "desc" }, { checkTime: "desc" }],
    take: 1000,
  });

  const deciders = await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.decidedById).filter((v): v is number => v != null) } }, select: { id: true, name: true } });
  const deciderName = new Map(deciders.map((d) => [d.id, d.name]));
  const templates = await prisma.uniformTemplate.findMany({ where: { id: { in: rows.map((r) => r.templateId).filter((v): v is number => v != null) } }, select: { id: true, name: true, colorHex: true } });
  const tpl = new Map(templates.map((t) => [t.id, t]));

  return json({
    rows: rows.map((r) => {
      const e = byId.get(r.employeeId);
      return {
        id: r.id,
        workDate: r.workDate,
        departmentId: r.departmentId,
        employee: e ? { id: e.id, code: e.code, name: e.name, department: e.department.name } : null,
        status: r.status,
        machineStatus: r.machineStatus,
        mode: r.mode,
        reason: r.reason,
        reasonText: r.reason ? (UNIFORM_REASON_LABEL[r.reason as UniformReason] ?? r.reason) : null,
        template: r.templateId ? (tpl.get(r.templateId) ?? null) : null,
        score: r.score,
        embedScore: r.embedScore,
        colorScore: r.colorScore,
        cropUrl: r.cropUrl,
        checkTime: r.checkTime.toISOString(),
        decidedBy: r.decidedById ? (deciderName.get(r.decidedById) ?? null) : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        note: r.note,
        detail: r.detail,
      };
    }),
  });
});
