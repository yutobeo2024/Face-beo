import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { notificationsReadSchema } from "@/lib/tasks/schemas";

/** Đánh dấu đã đọc: `{ ids }` hoặc `{ all: true }`. Chỉ đụng thông báo của chính mình. */
export const POST = handle(async (req) => {
  const u = await requireTasks(req);
  const body = await parseJson(req, notificationsReadSchema);
  if (!body.all && !body.ids?.length) throw badRequest("Cần ids hoặc all");
  const r = await prisma.inAppNotification.updateMany({
    where: { employeeId: u.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids } }) },
    data: { readAt: new Date() },
  });
  return json({ ok: true, updated: r.count });
});
