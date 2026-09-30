import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, json, notFound, readLimitedBody } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { MAX_SAMPLE_BYTES, SAMPLE_KINDS, addSample, type SampleKind } from "@/lib/uniform-admin";

type P = { id: string };

/** PUT /api/uniform/templates/:id/samples?kind=SHIRT|WORN — thân yêu cầu là ảnh thô (JPG/PNG/WebP ≤ 2 MB). */
export const PUT = handle<P>(async (req, ctx) => {
  const u = await requirePerm(req, "uniform.manage");
  const id = await idParam(ctx);
  const t = await prisma.uniformTemplate.findUnique({ where: { id }, select: { departmentId: true, name: true } });
  if (!t) throw notFound("Không có mẫu áo này");
  if (!canManageDept(u, t.departmentId)) throw forbidden();

  const kindRaw = new URL(req.url).searchParams.get("kind") ?? "SHIRT";
  const kind = (SAMPLE_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SampleKind) : "SHIRT";
  const buf = await readLimitedBody(req, MAX_SAMPLE_BYTES, "Ảnh quá lớn (tối đa 2 MB)");
  const sample = await addSample(id, buf, kind, u.id);
  const after = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id }, select: { sampleCount: true, colorHex: true, colorHist: true } });
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: id, detail: { addedSample: sample.id, kind, sampleCount: after.sampleCount } });
  return json({ sample: { id: sample.id, kind: sample.kind }, sampleCount: after.sampleCount, colorHex: after.colorHex, ready: !!after.colorHist });
});
