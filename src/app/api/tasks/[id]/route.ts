import { handle, idParam, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { taskPatchSchema } from "@/lib/tasks/schemas";
import { deleteTask, loadTask, taskDtos, updateTask } from "@/lib/tasks/tasks";
import { notifyAssigned } from "@/lib/tasks/task-notify";

export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  return json({ task: (await taskDtos(lp, [task]))[0] });
});

/** Sửa trường (KHÔNG đổi trạng thái — dùng POST /status). Gửi trường nào sửa trường đó. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  const body = await parseJson(req, taskPatchSchema);
  const r = await updateTask(lp, task, body);
  await audit({ actorId: u.id, action: "TASK_UPDATE", entity: "Task", entityId: task.id, detail: { fields: Object.keys(body), added: r.added, removed: r.removed } });
  if (r.added.length) await notifyAssigned(lp.project, r.task, u, r.added);
  return json({ task: (await taskDtos(lp, [r.task]))[0] });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  await deleteTask(lp, task);
  await audit({ actorId: u.id, action: "TASK_DELETE", entity: "Task", entityId: task.id, detail: { projectId: lp.project.id, title: task.title } });
  return json({ ok: true });
});
