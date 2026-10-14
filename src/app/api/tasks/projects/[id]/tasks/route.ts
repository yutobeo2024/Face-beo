import { handle, idParam, json, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { loadProjectCtx } from "@/lib/tasks/projects";
import { taskCreateSchema, tasksQuerySchema } from "@/lib/tasks/schemas";
import { createTask, listTasks, taskDtos } from "@/lib/tasks/tasks";
import { notifyTaskCreated } from "@/lib/tasks/task-notify";

/** Việc trong dự án — Cộng tác chỉ thấy việc được giao / tự tạo. */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const q = parseQuery(req, tasksQuerySchema);
  return json({ tasks: await taskDtos(lp, await listTasks(lp, q)) });
});

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const body = await parseJson(req, taskCreateSchema);
  const { task } = await createTask(lp, body);
  await audit({ actorId: u.id, action: "TASK_CREATE", entity: "Task", entityId: task.id, detail: { projectId: lp.project.id, title: task.title } });
  await notifyTaskCreated(lp.project, task, u);
  return json({ task: (await taskDtos(lp, [task]))[0] }, { status: 201 });
});
