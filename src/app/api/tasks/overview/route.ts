import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { projectCounts, toProjectDto } from "@/lib/tasks/projects";
import { projectsQuerySchema } from "@/lib/tasks/schemas";
import type { ProjectRole } from "@/lib/tasks/types";

/** Tổng quan mọi dự án (trang /admin/tasks). `?deleted=1`: dự án đã xóa mềm. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "tasks.manageAll");
  const q = parseQuery(req, projectsQuerySchema);
  const rows = await prisma.project.findMany({ where: { deletedAt: q.deleted === "1" ? { not: null } : null }, orderBy: { updatedAt: "desc" }, take: 1000 });
  const ids = rows.map((r) => r.id);
  const [counts, owners, mine] = await Promise.all([
    projectCounts(ids),
    prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, code: true, name: true, active: true } }),
    prisma.projectMember.findMany({ where: { employeeId: u.id, projectId: { in: ids } }, select: { projectId: true, role: true } }),
  ]);
  const owner = new Map(owners.map((o) => [o.id, o]));
  const role = new Map(mine.map((m) => [m.projectId, m.role as ProjectRole]));
  const projects = rows.map((p) => ({ ...toProjectDto(p, role.get(p.id) ?? null, counts.get(p.id)), owner: owner.get(p.ownerId) ?? null }));
  const kpi = projects.reduce(
    (a, p) => ({ projects: a.projects + 1, tasks: a.tasks + (p.counts?.total ?? 0), done: a.done + (p.counts?.done ?? 0), overdue: a.overdue + (p.counts?.overdue ?? 0) }),
    { projects: 0, tasks: 0, done: 0, overdue: 0 },
  );
  return json({ projects, kpi });
});
