import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { addDays, todayVN, vnDayRange } from "@/lib/attendance";
import { can } from "@/lib/permissions";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { projectCtxFor } from "@/lib/tasks/projects";
import { myTasksQuerySchema } from "@/lib/tasks/schemas";
import { hideInvisibleDeps, TASK_INCLUDE, toTaskDto } from "@/lib/tasks/tasks";
import type { ProjectCtx } from "@/lib/tasks/project-access";

/** Việc của tôi: được giao hoặc tự tạo, ở dự án chưa xóa mà mình còn là thành viên. Mặc định ẩn việc đã xong. */
export const GET = handle(async (req) => {
  const u = await requireTasks(req);
  const q = parseQuery(req, myTasksQuerySchema);
  const now = new Date();
  const today = todayVN(now);
  const [manageAll, snaps] = await Promise.all([can(u, "tasks.manageAll"), can(u, "snapshots.view")]);
  const and: Prisma.TaskWhereInput[] = [
    { OR: [{ createdById: u.id }, { assignees: { some: { employeeId: u.id } } }] },
    { project: manageAll || u.role === "ADMIN" ? { deletedAt: null } : { deletedAt: null, members: { some: { employeeId: u.id } } } },
  ];
  if (q.done !== "1") and.push({ status: { not: "DONE" } });
  if (q.due === "overdue") and.push({ status: { not: "DONE" }, dueAt: { lt: now } });
  if (q.due === "today") and.push({ dueAt: { gte: vnDayRange(today).start, lt: vnDayRange(today).end } });
  if (q.due === "week") and.push({ dueAt: { lt: vnDayRange(addDays(today, 6)).end } });
  const rows = await prisma.task.findMany({
    where: { AND: and },
    include: { ...TASK_INCLUDE, project: { select: { id: true, name: true, color: true } } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 300,
  });
  const ctxs = new Map<number, ProjectCtx>();
  for (const pid of new Set(rows.map((r) => r.projectId))) ctxs.set(pid, await projectCtxFor(u, pid, manageAll));
  const tasks = [];
  for (const t of rows) {
    const ctx = ctxs.get(t.projectId)!;
    tasks.push({ ...(await hideInvisibleDeps(ctx, [toTaskDto(u, ctx, t, snaps)]))[0], project: t.project });
  }
  return json({ tasks });
});
