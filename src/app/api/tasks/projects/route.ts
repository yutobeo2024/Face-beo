import { prisma } from "@/lib/db";
import { handle, json, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { can, requirePerm } from "@/lib/permissions";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { createProject, projectCounts, projectsScopeWhere, toProjectDto } from "@/lib/tasks/projects";
import { projectCreateSchema, projectsQuerySchema } from "@/lib/tasks/schemas";
import type { ProjectRole } from "@/lib/tasks/types";

/** Dự án người dùng là thành viên (người có tasks.manageAll / Quản trị: mọi dự án). `?deleted=1`: thùng rác của mình. */
export const GET = handle(async (req) => {
  const u = await requireTasks(req);
  const q = parseQuery(req, projectsQuerySchema);
  const [manageAll, canCreate] = await Promise.all([can(u, "tasks.manageAll"), can(u, "tasks.createProject")]);
  const deleted = q.deleted === "1";
  const rows = await prisma.project.findMany({
    // Thùng rác: người thường chỉ thấy dự án mình làm chủ (chỉ chủ khôi phục được).
    where: deleted && !manageAll && u.role !== "ADMIN" ? { deletedAt: { not: null }, ownerId: u.id } : projectsScopeWhere(u, manageAll, deleted),
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const ids = rows.map((r) => r.id);
  const mine = await prisma.projectMember.findMany({ where: { employeeId: u.id, projectId: { in: ids } }, select: { projectId: true, role: true } });
  const role = new Map(mine.map((m) => [m.projectId, m.role as ProjectRole]));
  // Cộng tác chỉ được biết về việc của chính mình — kể cả con số trên thẻ dự án.
  const narrow = manageAll || u.role === "ADMIN" ? [] : ids.filter((id) => role.get(id) === "CONTRIBUTOR");
  const [wide, own] = await Promise.all([projectCounts(ids.filter((id) => !narrow.includes(id))), projectCounts(narrow, new Date(), u.id)]);
  const counts = new Map([...wide, ...own]);
  return json({ projects: rows.map((p) => toProjectDto(p, role.get(p.id) ?? null, counts.get(p.id))), canCreate, manageAll });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "tasks.createProject");
  const body = await parseJson(req, projectCreateSchema);
  const p = await createProject(u, body);
  await audit({ actorId: u.id, action: "PROJECT_CREATE", entity: "Project", entityId: p.id, detail: { name: p.name, zaloGroupId: p.zaloGroupId } });
  return json({ project: toProjectDto(p, "OWNER") }, { status: 201 });
});
