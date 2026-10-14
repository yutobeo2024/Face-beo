import { handle, idParam, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { intParam, requireTasks } from "@/lib/tasks/route-helpers";
import { listMembers, loadProjectCtx, removeMember } from "@/lib/tasks/projects";

/** Gỡ thành viên (gỡ luôn khỏi các việc được giao trong dự án). Tự rời dự án cũng dùng route này. */
export const DELETE = handle<{ id: string; employeeId: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const employeeId = await intParam(ctx, "employeeId");
  const m = await removeMember(lp, employeeId);
  await audit({ actorId: u.id, action: "PROJECT_MEMBER", entity: "Project", entityId: lp.project.id, detail: { removed: employeeId, role: m.role } });
  return json({ members: employeeId === u.id ? [] : await listMembers(u, lp.project.id) });
});
