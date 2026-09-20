import { prisma } from "@/lib/db";
import { handle, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { requirePerm } from "@/lib/permissions";
import { infoLinkSchema } from "@/lib/validators";
import { assertDeptsExist, assertLinkScope, inScope, parseIds, toDto, uniqIds } from "@/lib/info-links";

/** Danh sách liên kết để quản trị (kể cả đang ẩn). Quản lý chỉ thấy liên kết trong phạm vi phòng mình. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "links.manage");
  const rows = await prisma.infoLink.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] });
  return json({ links: rows.filter((r) => inScope(u, parseIds(r.visibleDeptIds))).map(toDto) });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "links.manage");
  const body = await parseJson(req, infoLinkSchema);
  const deptIds = uniqIds(body.visibleDeptIds);
  assertLinkScope(u, deptIds);
  await assertDeptsExist(deptIds);
  const row = await prisma.infoLink.create({
    data: {
      title: body.title,
      url: body.url,
      description: body.description ?? null,
      icon: body.icon,
      color: body.color,
      order: body.order,
      active: body.active,
      visibleRoles: JSON.stringify([...new Set(body.visibleRoles)]),
      visibleDeptIds: JSON.stringify(deptIds),
      createdById: u.id,
    },
  });
  await audit({ actorId: u.id, action: "INFOLINK_UPDATE", entity: "InfoLink", entityId: row.id, detail: { created: true, title: row.title, url: row.url, visibleRoles: [...new Set(body.visibleRoles)], visibleDeptIds: deptIds } });
  await announce(u, `đã thêm liên kết "${row.title}" vào mục Thông tin`, { key: `infolink:create:${row.id}` });
  return json({ link: toDto(row) }, { status: 201 });
});
