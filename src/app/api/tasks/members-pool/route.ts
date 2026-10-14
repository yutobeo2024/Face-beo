import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, json, parseQuery } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { canManageProject } from "@/lib/tasks/project-access";
import { loadProjectCtx } from "@/lib/tasks/projects";
import { membersPoolQuerySchema } from "@/lib/tasks/schemas";

/** Nhân viên đang làm có thể thêm vào dự án: CHỈ id, mã, tên, tên phòng (không SĐT / dữ liệu cá nhân). */
export const GET = handle(async (req) => {
  const u = await requireTasks(req);
  const q = parseQuery(req, membersPoolQuerySchema);
  if (!q.projectId) throw badRequest("Cần projectId");
  const lp = await loadProjectCtx(u, q.projectId);
  if (!canManageProject(lp.ctx)) throw forbidden("Chỉ quản lý dự án được thêm thành viên");
  const rows = await prisma.employee.findMany({
    where: {
      active: true,
      projectMemberships: { none: { projectId: q.projectId } },
      ...(q.q ? { OR: [{ code: { contains: q.q.toUpperCase() } }, { name: { contains: q.q } }] } : {}),
    },
    select: { id: true, code: true, name: true, department: { select: { name: true } } },
    orderBy: { code: "asc" },
    take: 50,
  });
  return json({ people: rows.map((e) => ({ id: e.id, code: e.code, name: e.name, department: e.department.name })) });
});
