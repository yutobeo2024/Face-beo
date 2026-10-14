/**
 * Số liệu Dashboard dự án (v1.24.0) — hàm thuần, có unit test. Mốc ngày theo giờ VN.
 *
 * Đường tiến độ (burnup) dựng từ trạng thái HIỆN TẠI: `scope` = việc đã tạo trước cuối ngày, `done` = việc có
 * `completedAt` trước cuối ngày. Việc từng xong rồi bị kéo ngược lại thì `completedAt` đã bị xóa ⇒ không còn tính là xong
 * ở các ngày cũ (không lưu lịch sử từng lần đổi trạng thái).
 */
import { addDays, vnDayRange } from "../attendance";
import { TASK_PRIORITIES, type TaskPriority, type TaskStatus } from "./types";

export type StatTask = {
  status: TaskStatus | string;
  priority: TaskPriority | string;
  dueAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  assignees: { id: number; name: string }[];
};

export type AssigneeStat = { id: number; name: string; total: number; done: number; overdue: number };

export type ProjectStats = {
  from: string;
  to: string;
  total: number;
  todo: number;
  doing: number;
  review: number;
  done: number;
  overdue: number;
  /** Trung bình giờ từ lúc tạo tới lúc xong, của các việc xong TRONG khoảng; null = chưa có việc nào. */
  avgCompletionHours: number | null;
  completedInRange: number;
  byPriority: Record<TaskPriority, { total: number; open: number }>;
  /** id 0 = việc chưa giao cho ai. */
  byAssignee: AssigneeStat[];
  burnup: { date: string; scope: number; done: number }[];
};

export function computeStats(tasks: StatTask[], now: Date, range: { from: string; to: string }): ProjectStats {
  const open = (t: StatTask) => t.status !== "DONE";
  const late = (t: StatTask) => open(t) && t.dueAt.getTime() < now.getTime();
  const count = (s: string) => tasks.filter((t) => t.status === s).length;

  const rangeStart = vnDayRange(range.from).start.getTime();
  const rangeEnd = vnDayRange(range.to).end.getTime();
  const finished = tasks.filter((t) => t.completedAt && t.completedAt.getTime() >= rangeStart && t.completedAt.getTime() < rangeEnd);
  const avg = finished.length ? finished.reduce((a, t) => a + (t.completedAt!.getTime() - t.createdAt.getTime()), 0) / finished.length / 3_600_000 : null;

  const byPriority = Object.fromEntries(TASK_PRIORITIES.map((p) => [p, { total: 0, open: 0 }])) as ProjectStats["byPriority"];
  for (const t of tasks) {
    const b = byPriority[t.priority as TaskPriority];
    if (!b) continue;
    b.total++;
    if (open(t)) b.open++;
  }

  const people = new Map<number, AssigneeStat>();
  for (const t of tasks) {
    const list = t.assignees.length ? t.assignees : [{ id: 0, name: "Chưa giao" }];
    for (const a of list) {
      const s = people.get(a.id) ?? { id: a.id, name: a.name, total: 0, done: 0, overdue: 0 };
      s.total++;
      if (!open(t)) s.done++;
      if (late(t)) s.overdue++;
      people.set(a.id, s);
    }
  }
  const byAssignee = [...people.values()].sort((a, b) => (a.id === 0 ? 1 : b.id === 0 ? -1 : b.total - a.total || a.name.localeCompare(b.name)));

  const burnup: ProjectStats["burnup"] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const end = vnDayRange(d).end.getTime();
    burnup.push({
      date: d,
      scope: tasks.filter((t) => t.createdAt.getTime() < end).length,
      done: tasks.filter((t) => t.completedAt && t.completedAt.getTime() < end).length,
    });
  }

  return {
    from: range.from,
    to: range.to,
    total: tasks.length,
    todo: count("TODO"),
    doing: count("DOING"),
    review: count("REVIEW"),
    done: count("DONE"),
    overdue: tasks.filter(late).length,
    avgCompletionHours: avg === null ? null : Math.round(avg * 10) / 10,
    completedInRange: finished.length,
    byPriority,
    byAssignee,
    burnup,
  };
}
