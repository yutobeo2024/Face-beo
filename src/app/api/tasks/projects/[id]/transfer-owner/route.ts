import { handle, idParam, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { listMembers, loadProjectCtx, transferOwner } from "@/lib/tasks/projects";
import { transferOwnerSchema } from "@/lib/tasks/schemas";

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const { employeeId } = await parseJson(req, transferOwnerSchema);
  const r = await transferOwner(lp, employeeId);
  await audit({ actorId: u.id, action: "PROJECT_MEMBER", entity: "Project", entityId: lp.project.id, detail: { transferOwner: r } });
  return json({ members: await listMembers(u, lp.project.id) });
});
