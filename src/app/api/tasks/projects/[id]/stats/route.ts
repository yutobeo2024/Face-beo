import { prisma } from "@/lib/db";
import { handle, idParam, json, parseQuery } from "@/lib/api";
import { addDays, todayVN } from "@/lib/attendance";
import { requireTasks } from "@/lib/tasks/route-helpers";
import { loadProjectCtx } from "@/lib/tasks/projects";
import { taskVisibilityWhere } from "@/lib/tasks/project-access";
import { statsQuerySchema } from "@/lib/tasks/schemas";
import { computeStats } from "@/lib/tasks/task-stats";

const STATS_CAP = 5000;

/** Số liệu Dashboard dự án — chỉ đếm việc người xem được thấy (Cộng tác: việc của mình). Mặc định 30 ngày gần nhất. */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireTasks(req);
  const lp = await loadProjectCtx(u, await idParam(ctx));
  const q = parseQuery(req, statsQuerySchema);
  const now = new Date();
  const to = q.to ?? todayVN(now);
  const from = q.from ?? addDays(to, -29);
  const rows = await prisma.task.findMany({
    where: { AND: [{ projectId: lp.project.id }, taskVisibilityWhere(lp.ctx)] },
    select: { status: true, priority: true, dueAt: true, createdAt: true, completedAt: true, assignees: { select: { employee: { select: { id: true, name: true } } } } },
    orderBy: { id: "desc" },
    take: STATS_CAP,
  });
  const tasks = rows.map((r) => ({ ...r, assignees: r.assignees.map((a) => a.employee) }));
  // Dự án quá lớn: số liệu chỉ tính trên STATS_CAP việc mới nhất — báo cho giao diện thay vì sai âm thầm.
  return json({ stats: computeStats(tasks, now, { from, to }), truncated: rows.length === STATS_CAP });
});
