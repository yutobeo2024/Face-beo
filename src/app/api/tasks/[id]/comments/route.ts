import { handle, idParam, json, parseJson } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { commentSchema } from "@/lib/tasks/schemas";
import { addComment, listComments, loadTask } from "@/lib/tasks/tasks";
import { notifyComment } from "@/lib/tasks/task-notify";

export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  return json({ comments: await listComments(lp, task.id) });
});

/** Bình luận; nhắc người bằng "@mã NV" (vd. @NV007). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const { lp, task } = await loadTask(u, await idParam(ctx));
  const { text } = await parseJson(req, commentSchema);
  const { comment, mentions } = await addComment(lp, task, text);
  await notifyComment(lp.project, task, comment.id, mentions, u);
  return json({ comments: await listComments(lp, task.id) }, { status: 201 });
});
