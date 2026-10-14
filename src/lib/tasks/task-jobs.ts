/**
 * Job nền phân hệ Công việc (v1.23.0). Mọi job idempotent — chạy lại không tạo trùng (unique + dedupeKey).
 *  - task-recurrence (10 phút): bản lặp của hôm nay cho việc lặp; không bù quá 24 giờ.
 *  - task-reminders (phút 05 mỗi giờ): (a) nhắc cá nhân theo "Nhắc trước" (đổi hạn ⇒ nhắc lại); (b) tin nhóm gom việc
 *    đến hạn trong 1 giờ tới.
 *  - task-overdue-digest (09:00): mỗi dự án một tin việc quá hạn (≤ 15 dòng), chuông 1 dòng / người / ngày.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { todayVN, vnDate, vnDayRange, vnTime } from "../attendance";
import { fmtDate, fmtDT } from "../notify";
import { sendZaloMessage } from "../zalo-oa";
import { dueOccurrences, occurrenceDueAt, shiftStartDate } from "./recurrence";
import { currentMembers, pushInApp, zaloGroup } from "./task-notify";
import { REMINDER_HOURS, REMINDER_LABEL, type Reminder } from "./types";

const OPEN = { status: { not: "DONE" }, project: { deletedAt: null } } satisfies Prisma.TaskWhereInput;
const DIGEST_LINES = 15;

export async function taskRecurrence(now = new Date()) {
  const roots = await prisma.task.findMany({
    where: { recurrence: { not: "NONE" }, parentId: null, project: { deletedAt: null } },
    include: { assignees: true, subtasks: { orderBy: { sortOrder: "asc" } } },
  });
  let created = 0;
  let failed = 0;
  for (const t of roots) {
    // Một việc hỏng dữ liệu không được chặn bản lặp của mọi việc khác.
    try {
      created += await recurOne(t, now);
    } catch (e) {
      failed++;
      console.error(`[tasks] việc lặp #${t.id} lỗi:`, (e as Error).message);
    }
  }
  return { roots: roots.length, created, failed };
}

type RootRow = Prisma.TaskGetPayload<{ include: { assignees: true; subtasks: true } }>;

async function recurOne(t: RootRow, now: Date) {
  let created = 0;
  const lead = REMINDER_HOURS[t.reminder as Exclude<Reminder, "NONE">] ?? 0;
  for (const date of dueOccurrences(t, now, { leadHours: lead })) {
    // Người đã nghỉ việc / đã rời dự án không được chép sang bản lặp mới.
    const people = await currentMembers(t.projectId, t.assignees.map((a) => a.employeeId));
    try {
      const copy = await prisma.task.create({
        data: {
          projectId: t.projectId,
          title: t.title,
          description: t.description,
          status: "TODO",
          priority: t.priority,
          reminder: t.reminder,
          recurrence: "NONE",
          parentId: t.id,
          occurrenceDate: date,
          dueAt: occurrenceDueAt(t, date),
          startDate: shiftStartDate(t, date),
          createdById: t.createdById,
          assignees: { create: people.map((employeeId) => ({ employeeId })) },
          subtasks: { create: t.subtasks.map((s) => ({ text: s.text, sortOrder: s.sortOrder, done: false })) },
        },
      });
      created++;
      await pushInApp(
        people.map((employeeId) => ({
          employeeId,
          kind: "TASK_ASSIGNED" as const,
          title: `Việc lặp mới: ${t.title}`,
          body: `Hạn ${fmtDT(copy.dueAt)}`,
          projectId: t.projectId,
          taskId: copy.id,
          dedupeKey: `task-recur:${copy.id}:${employeeId}`,
        })),
      );
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // đã có bản lặp ngày này
    }
    // Ghi mốc đã sinh: bản lặp bị xóa sau đó KHÔNG sinh lại trong 24 giờ "nhìn lại".
    await prisma.task.updateMany({ where: { id: t.id, OR: [{ lastOccurrence: null }, { lastOccurrence: { lt: date } }] }, data: { lastOccurrence: date } });
  }
  return created;
}

export async function taskReminders(now = new Date()) {
  // (a) Nhắc cá nhân: mốc nhắc = hạn − N giờ, đã tới và chưa quá 24 giờ (server tắt lâu thì bỏ, không nhắc dồn).
  const maxLead = Math.max(...Object.values(REMINDER_HOURS));
  const candidates = await prisma.task.findMany({
    where: { ...OPEN, reminder: { not: "NONE" }, dueAt: { gt: new Date(now.getTime() - 24 * 3600_000), lte: new Date(now.getTime() + maxLead * 3600_000) } },
    include: { assignees: true, project: { select: { id: true, name: true } } },
  });
  let personal = 0;
  for (const t of candidates) {
    const lead = REMINDER_HOURS[t.reminder as Exclude<Reminder, "NONE">];
    if (lead === undefined) continue;
    const at = t.dueAt.getTime() - lead * 3600_000;
    if (at > now.getTime() || at <= now.getTime() - 24 * 3600_000) continue;
    const people = await currentMembers(t.projectId, t.assignees.length ? t.assignees.map((a) => a.employeeId) : [t.createdById]);
    const whenLabel = REMINDER_LABEL[t.reminder as Reminder];
    for (const employeeId of people) {
      const key = `task-remind:${t.id}:${t.reminder}:${t.dueAt.toISOString()}:${employeeId}`;
      const n = await pushInApp([
        { employeeId, kind: "TASK_DUE_SOON", title: `Nhắc hạn: ${t.title}`, body: `${t.project.name} · hạn ${fmtDT(t.dueAt)}`, projectId: t.projectId, taskId: t.id, dedupeKey: key },
      ]);
      if (!n) continue; // đã nhắc mốc này
      personal++;
      await sendZaloMessage({ toEmployeeId: employeeId, messageType: "TASK_DUE_PERSONAL", data: { projectId: t.projectId, projectName: t.project.name, title: t.title, taskId: t.id, dueText: fmtDT(t.dueAt), whenLabel }, dedupeKey: key });
    }
  }

  // (b) Tin nhóm: việc đến hạn trong (now, now + 1 giờ], gom theo dự án. Job chạy mỗi giờ nên mỗi việc vào đúng một tin.
  const soon = await prisma.task.findMany({
    where: { ...OPEN, dueAt: { gt: now, lte: new Date(now.getTime() + 3600_000) }, project: { deletedAt: null, zaloGroupId: { not: null } } },
    include: { assignees: { include: { employee: { select: { name: true } } } }, project: true },
    orderBy: { dueAt: "asc" },
  });
  const hourKey = vnDate(now).replaceAll("-", "") + vnTime(now).slice(0, 2);
  let groups = 0;
  for (const [, list] of groupBy(soon, (t) => t.projectId)) {
    const p = list[0].project;
    const r = await zaloGroup(p, "onTaskNearDueDate", "TASK_DUE_SOON", { projectName: p.name, items: lines(list), more: Math.max(0, list.length - DIGEST_LINES) }, `task-due1h:${p.id}:${hourKey}`);
    if (r && r.status !== "DUPLICATE") groups++;
  }
  return { personal, groups, soon: soon.length };
}

export async function taskOverdueDigest(now = new Date()) {
  const today = todayVN(now);
  const overdue = await prisma.task.findMany({
    where: { ...OPEN, dueAt: { lt: vnDayRange(today).start } },
    include: { assignees: { include: { employee: { select: { name: true } } } }, project: true },
    orderBy: { dueAt: "asc" },
  });
  let groups = 0;
  const perPerson = new Map<number, number>();
  for (const [, list] of groupBy(overdue, (t) => t.projectId)) {
    const p = list[0].project;
    const r = await zaloGroup(p, "onTaskNearDueDate", "TASK_OVERDUE_DIGEST", { projectName: p.name, dateText: fmtDate(today), items: lines(list), more: Math.max(0, list.length - DIGEST_LINES) }, `task-overdue:${p.id}:${today}`);
    if (r && r.status !== "DUPLICATE") groups++;
    for (const t of list) {
      for (const id of await currentMembers(p.id, t.assignees.length ? t.assignees.map((a) => a.employeeId) : [t.createdById])) perPerson.set(id, (perPerson.get(id) ?? 0) + 1);
    }
  }
  const bells = await pushInApp(
    [...perPerson].map(([employeeId, n]) => ({ employeeId, kind: "TASK_OVERDUE" as const, title: `Bạn có ${n} việc quá hạn`, body: "Mở Công việc → Việc của tôi → Quá hạn", dedupeKey: `task-overdue:${today}:${employeeId}` })),
  );
  return { overdue: overdue.length, groups, bells };
}

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

const lines = (list: { title: string; dueAt: Date; assignees: { employee: { name: string } }[] }[]) =>
  list.slice(0, DIGEST_LINES).map((t) => ({ title: t.title, dueText: fmtDT(t.dueAt), assignees: t.assignees.map((a) => a.employee.name).join(", ") }));
