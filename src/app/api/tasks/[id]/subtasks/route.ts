import { handle, idParam, json, parseJson } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { subtasksPutSchema } from "@/lib/tasks/schemas";
import { loadTask, replaceSubtasks, taskDtos } from "@/lib/tasks/tasks";

/** Thay toàn bộ danh sách việc con (thứ tự = thứ tự gửi lên). */
export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  const { subtasks } = await parseJson(req, subtasksPutSchema);
  return json({ task: (await taskDtos(lp, [await replaceSubtasks(lp, task, subtasks)]))[0] });
});
