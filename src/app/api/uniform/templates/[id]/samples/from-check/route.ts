import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { addSampleFromCheck } from "@/lib/uniform-admin";

type P = { id: string };

const bodySchema = z.object({ checkId: z.coerce.number().int().positive() });

/**
 * POST /api/uniform/templates/:id/samples/from-check — lấy ảnh mẫu từ một lượt chấm công đã có.
 *
 * Cách lấy mẫu đúng điều kiện nhất: cùng camera, cùng đèn, cùng khoảng cách với lúc kiểm thật.
 */
export const POST = handle<P>(async (req, ctx) => {
  const u = await requirePerm(req, "uniform.manage");
  const id = await idParam(ctx);
  const t = await prisma.uniformTemplate.findUnique({ where: { id }, select: { departmentId: true } });
  if (!t) throw notFound("Không có mẫu áo này");
  if (!canManageDept(u, t.departmentId)) throw forbidden();

  const { checkId } = await parseJson(req, bodySchema);
  const sample = await addSampleFromCheck(id, checkId, u.id);
  const after = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id }, select: { sampleCount: true, colorHex: true, colorHist: true } });
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: id, detail: { addedSample: sample.id, fromCheck: checkId, sampleCount: after.sampleCount } });
  return json({ sample: { id: sample.id, kind: sample.kind }, sampleCount: after.sampleCount, colorHex: after.colorHex, ready: !!after.colorHist });
});
