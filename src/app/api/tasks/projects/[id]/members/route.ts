import { handle, idParam, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { listMembers, loadProjectCtx, setMembers } from "@/lib/tasks/projects";
import { membersPutSchema } from "@/lib/tasks/schemas";
import { notifyMemberAdded } from "@/lib/tasks/task-notify";

/** Thêm / đổi vai trò thành viên (không gồm Chủ dự án — dùng transfer-owner). */
export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const { members } = await parseJson(req, membersPutSchema);
  const added = await setMembers(lp, members);
  await audit({ actorId: u.id, action: "PROJECT_MEMBER", entity: "Project", entityId: lp.project.id, detail: { set: members, added } });
  await notifyMemberAdded(lp.project, added, u);
  return json({ members: await listMembers(u, lp.project.id) });
});
