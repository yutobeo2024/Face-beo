import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { inScope, isVisibleTo, parseIds, parseRoles } from "@/lib/info-links";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/**
 * Liên kết trong mục "Thông tin" của người đang đăng nhập.
 * - Nhân viên thường: chỉ liên kết đang bật và khớp vai trò ∩ phòng ban.
 * - Người có quyền `links.manage`: thấy thêm mọi liên kết đang bật trong phạm vi mình quản lý (để kiểm tra kết quả cấu hình);
 *   ô không dành cho chính họ mang nhãn `audience` ("Nhân viên · Hành chính") và `visibleToMe = false`.
 */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const canManage = await can(u, "links.manage");
  const rows = await prisma.infoLink.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const pick = (r: (typeof rows)[number]) => ({ id: r.id, title: r.title, url: r.url, description: r.description, icon: r.icon, color: r.color });
  if (!canManage) return json({ links: rows.filter((r) => isVisibleTo(r, u)).map(pick), canManage });

  const deptIds = [...new Set(rows.flatMap((r) => parseIds(r.visibleDeptIds)))];
  const depts = deptIds.length ? await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const links = rows
    // Thấy khi thuộc diện xem HOẶC liên kết nằm trong phạm vi mình quản lý (HR/ADMIN: mọi liên kết).
    .filter((r) => isVisibleTo(r, u) || inScope(u, parseIds(r.visibleDeptIds)))
    .map((r) => {
      const roles = parseRoles(r.visibleRoles).map((x) => ROLE_LABEL[x as Role] ?? x);
      const dn = parseIds(r.visibleDeptIds).map((d) => deptName.get(d) ?? `#${d}`);
      const visibleToMe = isVisibleTo(r, u);
      return { ...pick(r), visibleToMe, audience: visibleToMe ? null : [...roles, ...dn].join(" · ") };
    });
  return json({ links, canManage });
});
