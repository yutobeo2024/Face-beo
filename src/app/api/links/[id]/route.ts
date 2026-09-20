import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { requirePerm } from "@/lib/permissions";
import { infoLinkPatchSchema } from "@/lib/validators";
import { assertDeptsExist, assertLinkScope, inScope, parseIds, toDto, uniqIds } from "@/lib/info-links";

/** Quản lý chỉ được chạm liên kết nằm trọn trong phòng mình phụ trách (liên kết toàn công ty là của HR/Quản trị). */
async function loadInScope(u: Awaited<ReturnType<typeof requirePerm>>, id: number) {
  const row = await prisma.infoLink.findUnique({ where: { id } });
  if (!row) throw notFound();
  if (!inScope(u, parseIds(row.visibleDeptIds))) throw forbidden("Liên kết này không thuộc phạm vi phòng ban bạn quản lý");
  return row;
}

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "links.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, infoLinkPatchSchema);
  const row = await loadInScope(u, id);
  const deptIds = body.visibleDeptIds !== undefined ? uniqIds(body.visibleDeptIds) : parseIds(row.visibleDeptIds);
  assertLinkScope(u, deptIds);
  await assertDeptsExist(deptIds);
  const updated = await prisma.infoLink.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.url !== undefined && { url: body.url }),
      ...(body.description !== undefined && { description: body.description ?? null }),
      ...(body.icon !== undefined && { icon: body.icon }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.visibleRoles !== undefined && { visibleRoles: JSON.stringify([...new Set(body.visibleRoles)]) }),
      ...(body.visibleDeptIds !== undefined && { visibleDeptIds: JSON.stringify(deptIds) }),
    },
  });
  await audit({ actorId: u.id, action: "INFOLINK_UPDATE", entity: "InfoLink", entityId: id, detail: body });
  await announce(u, `đã sửa liên kết "${updated.title}" trong mục Thông tin`, { key: `infolink:update:${id}:${Date.now()}` });
  return json({ link: toDto(updated) });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "links.manage");
  const id = await idParam(ctx);
  const row = await loadInScope(u, id);
  await prisma.infoLink.delete({ where: { id } });
  await audit({ actorId: u.id, action: "INFOLINK_UPDATE", entity: "InfoLink", entityId: id, detail: { deleted: true, title: row.title, url: row.url } });
  await announce(u, `đã xóa liên kết "${row.title}" khỏi mục Thông tin`, { key: `infolink:delete:${id}` });
  return json({ ok: true });
});
