import { handle, idParam, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { statusSchema } from "@/lib/tasks/schemas";
import { changeStatus, loadTask, taskDtos } from "@/lib/tasks/tasks";
import { notifyStatusChanged } from "@/lib/tasks/task-notify";

/** Đổi trạng thái (kéo thẻ). Gửi kèm `fromStatus` để phát hiện hai người kéo cùng lúc (409). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  const { status, fromStatus } = await parseJson(req, statusSchema);
  const r = await changeStatus(lp, task, status, fromStatus);
  if (r.changed) {
    await audit({ actorId: u.id, action: "TASK_STATUS", entity: "Task", entityId: task.id, detail: { from: r.from, to: status } });
    await notifyStatusChanged(lp.project, r.task, r.from, status, u);
  }
  return json({ task: (await taskDtos(lp, [r.task]))[0] });
});
