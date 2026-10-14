import { handle, idParam, json, parseJson } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { dependenciesPutSchema } from "@/lib/tasks/schemas";
import { loadTask, setDependencies, taskDtos } from "@/lib/tasks/tasks";

/** Thay danh sách việc phải xong trước (cùng dự án, không vòng lặp). */
export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  const { dependsOn } = await parseJson(req, dependenciesPutSchema);
  return json({ task: (await taskDtos(lp, [await setDependencies(lp, task, dependsOn)]))[0] });
});
