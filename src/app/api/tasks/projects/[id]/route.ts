import { handle, idParam, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { canPickZaloGroup, listMembers, loadProjectCtx, softDeleteProject, toProjectDto, updateProject } from "@/lib/tasks/projects";
import { permsDto } from "@/lib/tasks/project-access";
import { projectPatchSchema } from "@/lib/tasks/schemas";

export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx), { allowDeleted: true });
  return json({
    project: toProjectDto(lp.project, lp.ctx.memberRole),
    members: await listMembers(u, lp.project.id),
    perms: { ...permsDto(lp.ctx), zaloGroup: await canPickZaloGroup(lp) },
  });
});

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const body = await parseJson(req, projectPatchSchema);
  const p = await updateProject(lp, body);
  await audit({ actorId: u.id, action: "PROJECT_UPDATE", entity: "Project", entityId: p.id, detail: { fields: Object.keys(body), name: p.name, zaloGroupId: p.zaloGroupId } });
  return json({ project: toProjectDto(p, lp.ctx.memberRole) });
});

/** Xóa MỀM (khôi phục được ở thùng rác). Chỉ chủ dự án / Quản trị. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  await softDeleteProject(lp);
  await audit({ actorId: u.id, action: "PROJECT_DELETE", entity: "Project", entityId: lp.project.id, detail: { name: lp.project.name } });
  await announce(u, `đã xóa dự án "${lp.project.name}" (khôi phục được trong thùng rác)`, { key: `project-delete:${lp.project.id}:${Date.now()}` });
  return json({ ok: true });
});
