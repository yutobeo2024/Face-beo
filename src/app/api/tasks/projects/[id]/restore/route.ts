import { handle, idParam, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { loadProjectCtx, restoreProject } from "@/lib/tasks/projects";

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx), { allowDeleted: true });
  await restoreProject(lp);
  await audit({ actorId: u.id, action: "PROJECT_DELETE", entity: "Project", entityId: lp.project.id, detail: { restored: true, name: lp.project.name } });
  return json({ ok: true });
});
