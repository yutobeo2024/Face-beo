import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, json, notFound } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { removeSample } from "@/lib/uniform-admin";
import { readTemplateSample } from "@/lib/uniform-storage";

type P = { id: string; sid: string };

const num = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("id không hợp lệ");
  return n;
};

async function loadSample(req: NextRequest, p: P, cap: "uniform.view" | "uniform.manage") {
  const u = await requirePerm(req, cap);
  const id = num(p.id);
  const sid = num(p.sid);
  const s = await prisma.uniformSample.findUnique({ where: { id: sid }, select: { id: true, fileKey: true, templateId: true, template: { select: { departmentId: true } } } });
  if (!s || s.templateId !== id) throw notFound("Không có ảnh mẫu này");
  if (!canManageDept(u, s.template.departmentId)) throw forbidden();
  return { u, s, id, sid };
}

/** GET: xem ảnh mẫu (chỉ người có quyền, trong phạm vi phòng). */
export const GET = handle<P>(async (req, ctx) => {
  const { s } = await loadSample(req, await ctx.params, "uniform.view");
  const buf = await readTemplateSample(s.fileKey);
  if (!buf) throw notFound("Ảnh đã bị xóa");
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
});

/** DELETE: bỏ một ảnh mẫu rồi tính lại đặc trưng của mẫu áo. */
export const DELETE = handle<P>(async (req, ctx) => {
  const { u, id, sid } = await loadSample(req, await ctx.params, "uniform.manage");
  await removeSample(id, sid);
  const after = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id }, select: { sampleCount: true, active: true } });
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: id, detail: { removedSample: sid, sampleCount: after.sampleCount } });
  return json({ ok: true, sampleCount: after.sampleCount, active: after.active });
});
