import { handle, idParam, json, parseJson, parseQuery } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { loadProjectCtx } from "@/lib/tasks/projects";
import { taskCreateSchema, tasksQuerySchema } from "@/lib/tasks/schemas";
import { createTask, listTasks, taskDtos, tasksWhere } from "@/lib/tasks/tasks";
import { prisma } from "@/lib/db";
import { vnDayRange } from "@/lib/attendance";
import { notifyTaskCreated } from "@/lib/tasks/task-notify";

/** Việc trong dự án — Cộng tác chỉ thấy việc được giao / tự tạo. */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const { gantt, ...q } = parseQuery(req, tasksQuerySchema);
  if (gantt === "1") {
    // Gantt: thanh = việc có ngày bắt đầu, khoảng [ngày bắt đầu, hạn] GIAO với cửa sổ [from, to] (không lọc theo hạn như Lịch).
    // Việc chưa có ngày bắt đầu (chỉ việc chưa xong) liệt kê riêng để người dùng đặt ngày.
    const { from, to, ...rest } = q;
    const overlap = from && to ? { startDate: { lte: to }, dueAt: { gte: vnDayRange(from).start } } : {};
    const [rows, unscheduled, unscheduledTotal] = await Promise.all([
      listTasks(lp, rest, { startDate: { not: null }, ...overlap }),
      listTasks(lp, rest, { startDate: null, status: { not: "DONE" } }, 200),
      prisma.task.count({ where: { AND: [tasksWhere(lp, rest), { startDate: null, status: { not: "DONE" } }] } }),
    ]);
    return json({ tasks: await taskDtos(lp, rows), unscheduled: await taskDtos(lp, unscheduled), unscheduledTotal });
  }
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
