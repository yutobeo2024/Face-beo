import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";
import { canHardDelete } from "@/lib/uniform-admin";
import { deleteTemplateDir } from "@/lib/uniform-storage";

type P = { id: string };
const patchSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() });

async function load(req: NextRequest, id: number, cap: "uniform.view" | "uniform.manage") {
  const u = await requirePerm(req, cap);
  const t = await prisma.uniformTemplate.findUnique({ where: { id }, select: { id: true, departmentId: true, name: true, active: true, sampleCount: true, colorHist: true } });
  if (!t) throw notFound("Không có mẫu áo này");
  if (!canManageDept(u, t.departmentId)) throw forbidden();
  return { u, t };
}

/** PATCH: đổi tên hoặc bật/tắt mẫu áo. Chưa có ảnh mẫu thì không cho bật. */
export const PATCH = handle<P>(async (req, ctx) => {
  const id = await idParam(ctx);
  const { u, t } = await load(req, id, "uniform.manage");
  const body = await patchSchema.parseAsync(await req.json()).catch(() => {
    throw badRequest("Dữ liệu không hợp lệ");
  });
  if (body.active === true && !t.colorHist) throw badRequest("Mẫu áo chưa có ảnh mẫu nên chưa bật được");
  if (body.name && body.name !== t.name) {
    const dup = await prisma.uniformTemplate.findFirst({ where: { departmentId: t.departmentId, name: body.name, NOT: { id } } });
    if (dup) throw badRequest("Phòng này đã có mẫu áo cùng tên");
  }
  const updated = await prisma.uniformTemplate.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: id, detail: { ...body, was: { name: t.name, active: t.active } } });
  return json({ template: { id: updated.id, name: updated.name, active: updated.active } });
});

/** DELETE: chỉ xóa cứng mẫu áo CHƯA từng dùng để kết luận — lịch sử là bất biến, còn lại thì tắt đi. */
export const DELETE = handle<P>(async (req, ctx) => {
  const id = await idParam(ctx);
  const { u, t } = await load(req, id, "uniform.manage");
  if (!(await canHardDelete(id))) throw badRequest("Mẫu áo đã dùng để kết luận đồng phục — chỉ có thể tắt, không xóa được");
  await prisma.uniformTemplate.delete({ where: { id } }); // ảnh mẫu xóa theo (cascade)
  await deleteTemplateDir(id);
  await audit({ actorId: u.id, action: "UNIFORM_TEMPLATE", entity: "UniformTemplate", entityId: id, detail: { deleted: t.name } });
  return json({ ok: true });
});
