import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

type P = { id: string };
/** Người chỉ được chọn Đạt / Không đạt — "cần xem lại" là kết luận của máy, không phải quyết định của người. */
const patchSchema = z.object({ status: z.enum(["PASS", "FAIL"]), note: z.string().trim().max(300).optional() });

/** PATCH: Nhân sự xác nhận một bản ghi. Không bao giờ ghi đè kết luận của máy (machineStatus). */
export const PATCH = handle<P>(async (req, ctx) => {
  const u = await requirePerm(req, "uniform.decide");
  const id = await idParam(ctx);
  const row = await prisma.uniformCheck.findUnique({ where: { id }, select: { id: true, departmentId: true, employeeId: true, workDate: true, status: true, machineStatus: true } });
  if (!row) throw notFound("Không có bản ghi này");
  if (!canManageDept(u, row.departmentId)) throw forbidden();
  const body = await patchSchema.parseAsync(await req.json()).catch(() => {
    throw badRequest("Chỉ nhận kết luận Đạt hoặc Không đạt");
  });

  const updated = await prisma.uniformCheck.update({
    where: { id },
    data: { status: body.status, note: body.note ?? null, decidedById: u.id, decidedAt: new Date() },
  });
  await audit({
    actorId: u.id,
    action: "UNIFORM_DECIDE",
    entity: "UniformCheck",
    entityId: id,
    detail: { workDate: row.workDate, from: row.status, to: body.status, machineStatus: row.machineStatus },
  });
  return json({ check: { id: updated.id, status: updated.status, decidedAt: updated.decidedAt?.toISOString() ?? null } });
});
