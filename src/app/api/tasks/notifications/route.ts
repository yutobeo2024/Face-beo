import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { notificationsQuerySchema } from "@/lib/tasks/schemas";
import type { InAppNotificationDto, NotificationKind } from "@/lib/tasks/types";

/** Chuông thông báo trong app (chỉ của chính mình). */
export const GET = handle(async (req) => {
  const u = await requireTasks(req);
  const q = parseQuery(req, notificationsQuerySchema);
  const [rows, unread] = await Promise.all([
    prisma.inAppNotification.findMany({ where: { employeeId: u.id, ...(q.unread === "1" ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: q.take }),
    prisma.inAppNotification.count({ where: { employeeId: u.id, readAt: null } }),
  ]);
  const notifications: InAppNotificationDto[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as NotificationKind,
    title: r.title,
    body: r.body,
    projectId: r.projectId,
    taskId: r.taskId,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return json({ notifications, unread });
});
