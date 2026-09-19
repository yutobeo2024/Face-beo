import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { assertShiftsExist, patternSchema } from "@/lib/work-patterns";
import { audit } from "@/lib/audit";
import { announce, onceKey } from "@/lib/announce";

/** Sửa mẫu tuần: ảnh hưởng mọi nhân viên cố định đang dùng mẫu — có nhật ký và tin nhóm Zalo. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, patternSchema.partial());
  const before = await prisma.workPattern.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!before) throw notFound();
  await assertShiftsExist(body);
  if (body.name && body.name !== before.name && (await prisma.workPattern.findUnique({ where: { name: body.name } }))) throw badRequest("Tên mẫu tuần đã tồn tại");
  const after = await prisma.workPattern.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "PATTERN_UPDATE", entity: "WorkPattern", entityId: id, detail: { before, after } });
  await announce(u, `đã sửa mẫu tuần làm việc "${after.name}"`, { key: onceKey("pattern-update", id), detail: `Áp dụng cho ${before._count.employees} nhân viên` });
  return json({ pattern: after });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const p = await prisma.workPattern.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!p) throw notFound();
  if (p._count.employees > 0) throw badRequest(`Mẫu đang được ${p._count.employees} nhân viên sử dụng, không thể xóa`);
  await prisma.workPattern.delete({ where: { id } });
  await audit({ actorId: u.id, action: "PATTERN_UPDATE", entity: "WorkPattern", entityId: id, detail: { deleted: p.name } });
  return json({ ok: true });
});
