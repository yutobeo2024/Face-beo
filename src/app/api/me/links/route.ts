import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isVisibleTo } from "@/lib/info-links";

/** Liên kết trong mục "Thông tin" mà người đang đăng nhập được thấy (đã lọc theo vai trò + phòng ban). */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const rows = await prisma.infoLink.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const links = rows
    .filter((r) => isVisibleTo(r, u))
    .map((r) => ({ id: r.id, title: r.title, url: r.url, description: r.description, icon: r.icon, color: r.color }));
  return json({ links, canManage: await can(u, "links.manage") });
});
