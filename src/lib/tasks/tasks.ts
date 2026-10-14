/**
 * Công việc (v1.23.0): danh sách, tạo, sửa, đổi trạng thái, việc con, phụ thuộc, bình luận.
 *
 * Luật khóa cứng:
 *  - Trạng thái + `completedAt` CHỈ đổi qua `changeStatus` (khóa theo việc + updateMany có điều kiện ⇒ 409 khi hai người
 *    kéo thẻ cùng lúc); sang DONE khi còn việc con chưa xong ⇒ 400 `SUBTASKS_PENDING`.
 *  - Người được giao phải là thành viên dự án; phụ thuộc cùng dự án, không tự trỏ, không chu trình.
 *  - Việc người dùng không được thấy ⇒ 404 (không lộ tồn tại).
 */
import type { Prisma, Task } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, forbidden, HttpError, notFound } from "../api";
import type { AuthUser } from "../auth";
import { can } from "../permissions";
import { withLock } from "../mutex";
import { vnDate, vnDayRange } from "../attendance";
import {
  canAssignTask,
  canComment,
  canCreateTask,
  canDeleteTask,
  canEditTask,
  canSeeAllTasks,
  canViewTask,
  taskPermsDto,
  taskVisibilityWhere,
  type ProjectCtx,
  type TaskRel,
} from "./project-access";
import { loadProjectCtx, PERSON_SELECT, toPersonDto, type LoadedProject } from "./projects";
import { parseIdList, type TaskCreateInput, type TaskPatchInput, type TasksQuery } from "./schemas";
import type { CommentDto, Recurrence, Reminder, TaskDto, TaskPriority, TaskStatus } from "./types";

export const TASK_INCLUDE = {
  assignees: { include: { employee: { select: PERSON_SELECT } } },
  subtasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  dependsOn: { select: { dependsOnId: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export const relOf = (t: { createdById: number; assignees: { employeeId: number }[] }): TaskRel => ({
  createdById: t.createdById,
  assigneeIds: t.assignees.map((a) => a.employeeId),
});

export function toTaskDto(u: AuthUser, ctx: ProjectCtx, t: TaskRow, canSnapshots: boolean): TaskDto {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    startDate: t.startDate,
    dueAt: t.dueAt.toISOString(),
    reminder: t.reminder as Reminder,
    recurrence: t.recurrence as Recurrence,
    recurrenceTime: t.recurrenceTime,
    parentId: t.parentId,
    occurrenceDate: t.occurrenceDate,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    assignees: t.assignees.map((a) => toPersonDto(u, a.employee, canSnapshots)),
    subtasks: t.subtasks.map((s) => ({ id: s.id, text: s.text, done: s.done, sortOrder: s.sortOrder })),
    dependsOn: t.dependsOn.map((d) => d.dependsOnId),
    commentCount: t._count.comments,
    perms: taskPermsDto(ctx, relOf(t)),
  };
}

export async function taskDtos(lp: LoadedProject, rows: TaskRow[]) {
  const snaps = await can(lp.user, "snapshots.view");
  const dtos = rows.map((t) => toTaskDto(lp.user, lp.ctx, t, snaps));
  return hideInvisibleDeps(lp.ctx, dtos);
}

/** Cộng tác: bỏ id các việc phụ thuộc mà người đó không thấy (không lộ việc khác tồn tại). */
export async function hideInvisibleDeps<T extends { dependsOn: number[] }>(ctx: ProjectCtx, dtos: T[]): Promise<T[]> {
  if (canSeeAllTasks(ctx)) return dtos;
  const ids = [...new Set(dtos.flatMap((d) => d.dependsOn))];
  if (!ids.length) return dtos;
  const visible = new Set((await prisma.task.findMany({ where: { AND: [{ id: { in: ids } }, taskVisibilityWhere(ctx)] }, select: { id: true } })).map((t) => t.id));
  return dtos.map((d) => ({ ...d, dependsOn: d.dependsOn.filter((id) => visible.has(id)) }));
}

/** Điều kiện lọc chung (đã gồm phạm vi thấy việc của người xem). */
export function tasksWhere(lp: LoadedProject, q: Omit<TasksQuery, "gantt">): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [{ projectId: lp.project.id }, taskVisibilityWhere(lp.ctx)];
  if (q.status) and.push({ status: q.status });
  if (q.done === "0") and.push({ status: { not: "DONE" } });
  if (q.assignee) and.push({ assignees: { some: { employeeId: q.assignee === "me" ? lp.user.id : q.assignee } } });
  if (q.q) and.push({ title: { contains: q.q } });
  if (q.from && q.to) and.push({ dueAt: { gte: vnDayRange(q.from).start, lt: vnDayRange(q.to).end } });
  return { AND: and };
}

export async function listTasks(lp: LoadedProject, q: Omit<TasksQuery, "gantt">, extra: Prisma.TaskWhereInput = {}, take = 1000) {
  return prisma.task.findMany({ where: { AND: [tasksWhere(lp, q), extra] }, include: TASK_INCLUDE, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take });
}

/** Nạp một việc theo id + quyền của người xem; không thấy ⇒ 404. */
export async function loadTask(u: AuthUser, taskId: number): Promise<{ lp: LoadedProject; task: TaskRow }> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!task) throw notFound("Không tìm thấy công việc");
  const lp = await loadProjectCtx(u, task.projectId).catch(() => {
    throw notFound("Không tìm thấy công việc");
  });
  if (!canViewTask(lp.ctx, relOf(task))) throw notFound("Không tìm thấy công việc");
  return { lp, task };
}

const getRow = (id: number) => prisma.task.findUniqueOrThrow({ where: { id }, include: TASK_INCLUDE });

/** Người được giao phải là thành viên dự án. */
async function assertMembers(projectId: number, ids: number[]) {
  if (!ids.length) return;
  const n = await prisma.projectMember.count({ where: { projectId, employeeId: { in: ids }, employee: { active: true } } });
  if (n !== ids.length) throw badRequest("Người được giao phải là thành viên (đang làm việc) của dự án");
}

/** Không đủ quyền đổi người được giao thì chỉ được tự nhận việc (hoặc để trống). */
function assertAssignable(lp: LoadedProject, rel: TaskRel, ids: number[]) {
  if (canAssignTask(lp.ctx, rel)) return;
  if (ids.every((id) => id === lp.user.id)) return;
  throw forbidden("Chỉ quản lý dự án hoặc người tạo việc được giao việc cho người khác");
}

export async function createTask(
  lp: LoadedProject,
  body: TaskCreateInput,
  opts: { createdById?: number } = {},
): Promise<{ task: TaskRow; assigneeIds: number[] }> {
  if (!canCreateTask(lp.ctx)) throw forbidden("Không có quyền tạo việc trong dự án này");
  if (lp.project.deletedAt) throw badRequest("Dự án đã bị xóa");
  const createdById = opts.createdById ?? lp.user.id;
  const ids = [...new Set(body.assigneeIds)];
  assertAssignable(lp, { createdById, assigneeIds: [] }, ids);
  await assertMembers(lp.project.id, ids);
  if (body.status === "DONE" && body.subtasks.length) throw new HttpError(400, "Còn việc con chưa xong", { code: "SUBTASKS_PENDING" });
  assertDates(body.startDate, body.dueAt);
  const t = await prisma.task.create({
    data: {
      projectId: lp.project.id,
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      startDate: body.startDate,
      dueAt: body.dueAt,
      reminder: body.reminder,
      recurrence: body.recurrence,
      recurrenceTime: body.recurrence === "NONE" ? null : body.recurrenceTime,
      completedAt: body.status === "DONE" ? new Date() : null,
      createdById,
      assignees: { create: ids.map((employeeId) => ({ employeeId })) },
      subtasks: { create: body.subtasks.map((text, i) => ({ text, sortOrder: i })) },
    },
  });
  return { task: await getRow(t.id), assigneeIds: ids };
}

function assertDates(startDate: string | null | undefined, dueAt: Date | undefined) {
  if (startDate && dueAt) {
    if (startDate > vnDate(dueAt)) throw badRequest("Ngày bắt đầu sau hạn hoàn thành");
  }
}

/** Sửa các trường (không gồm trạng thái). Trả về việc mới + id người MỚI được giao. */
export async function updateTask(lp: LoadedProject, stale: TaskRow, body: TaskPatchInput): Promise<{ task: TaskRow; added: number[]; removed: number[] }> {
  // Cùng khóa với changeStatus / replaceSubtasks: hai người sửa người được giao cùng lúc không đụng nhau (P2002 ⇒ 500).
  return withLock(`task:${stale.id}`, () => updateTaskLocked(lp, stale.id, body));
}

async function updateTaskLocked(lp: LoadedProject, taskId: number, body: TaskPatchInput): Promise<{ task: TaskRow; added: number[]; removed: number[] }> {
  const task = await getRow(taskId);
  const rel = relOf(task);
  if (!canEditTask(lp.ctx, rel)) throw forbidden("Không có quyền sửa việc này");
  const data: Prisma.TaskUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.dueAt !== undefined) data.dueAt = body.dueAt;
  if (body.reminder !== undefined) data.reminder = body.reminder;
  if (body.recurrence !== undefined || body.recurrenceTime !== undefined) {
    if (task.parentId !== null && body.recurrence && body.recurrence !== "NONE") throw badRequest("Bản lặp không đặt lặp được — sửa ở việc gốc");
    const rec = body.recurrence ?? task.recurrence;
    data.recurrence = rec;
    data.recurrenceTime = rec === "NONE" ? null : body.recurrenceTime !== undefined ? body.recurrenceTime : task.recurrenceTime;
  }
  assertDates(body.startDate !== undefined ? body.startDate : task.startDate, body.dueAt ?? task.dueAt);
  let added: number[] = [];
  let removed: number[] = [];
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (body.assigneeIds !== undefined) {
    const next = [...new Set(body.assigneeIds)];
    added = next.filter((id) => !rel.assigneeIds.includes(id));
    removed = rel.assigneeIds.filter((id) => !next.includes(id));
    if (added.length || removed.length) {
      // Không đủ quyền giao việc thì chỉ được tự nhận / tự bỏ mình.
      if (!canAssignTask(lp.ctx, rel) && [...added, ...removed].some((id) => id !== lp.user.id)) {
        throw forbidden("Chỉ quản lý dự án hoặc người tạo việc được giao việc cho người khác");
      }
      await assertMembers(lp.project.id, added);
      ops.push(prisma.taskAssignee.deleteMany({ where: { taskId: task.id, employeeId: { in: removed } } }));
      if (added.length) ops.push(prisma.taskAssignee.createMany({ data: added.map((employeeId) => ({ taskId: task.id, employeeId })) }));
    }
  }
  await prisma.$transaction([...ops, prisma.task.update({ where: { id: task.id }, data })]);
  return { task: await getRow(task.id), added, removed };
}

export class StatusConflict extends HttpError {
  constructor(current: string) {
    super(409, "Việc vừa được người khác đổi trạng thái — tải lại để xem", { code: "CONFLICT", status: current });
  }
}

/** Đổi trạng thái (kéo thẻ). `fromStatus` = trạng thái client đang thấy; lệch ⇒ 409. */
export async function changeStatus(lp: LoadedProject, task: TaskRow, status: TaskStatus, fromStatus?: TaskStatus): Promise<{ task: TaskRow; from: TaskStatus; changed: boolean }> {
  if (!canEditTask(lp.ctx, relOf(task))) throw forbidden("Không có quyền đổi trạng thái việc này");
  return withLock(`task:${task.id}`, async () => {
    const cur = await prisma.task.findUnique({ where: { id: task.id }, select: { status: true } });
    if (!cur) throw notFound("Không tìm thấy công việc");
    const from = cur.status as TaskStatus;
    if (fromStatus && fromStatus !== from) throw new StatusConflict(from);
    if (from === status) return { task: await getRow(task.id), from, changed: false };
    if (status === "DONE") {
      const pending = await prisma.subtask.findMany({ where: { taskId: task.id, done: false }, select: { id: true, text: true }, orderBy: { sortOrder: "asc" } });
      if (pending.length) throw new HttpError(400, `Còn ${pending.length} việc con chưa xong`, { code: "SUBTASKS_PENDING", pending });
    }
    const r = await prisma.task.updateMany({
      where: { id: task.id, status: from },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    if (r.count === 0) throw new StatusConflict(from);
    return { task: await getRow(task.id), from, changed: true };
  });
}

/** Thay danh sách việc con — cùng khóa với changeStatus để không lọt "Hoàn thành khi còn việc con chưa xong". */
export async function replaceSubtasks(lp: LoadedProject, task: TaskRow, items: { text: string; done: boolean }[]) {
  if (!canEditTask(lp.ctx, relOf(task))) throw forbidden("Không có quyền sửa việc này");
  return withLock(`task:${task.id}`, async () => {
    const cur = await prisma.task.findUnique({ where: { id: task.id }, select: { status: true } });
    if (!cur) throw notFound("Không tìm thấy công việc");
    if (cur.status === "DONE" && items.some((s) => !s.done)) {
      throw badRequest("Việc đã Hoàn thành — chuyển về trạng thái khác trước khi thêm / bỏ tích việc con");
    }
    await prisma.$transaction([
      prisma.subtask.deleteMany({ where: { taskId: task.id } }),
      prisma.subtask.createMany({ data: items.map((s, i) => ({ taskId: task.id, text: s.text, done: s.done, sortOrder: i })) }),
    ]);
    return getRow(task.id);
  });
}

/** Có đi được từ `start` tới `target` theo cạnh "phụ thuộc" không (DFS). */
export function reaches(edges: Map<number, number[]>, start: number, target: number): boolean {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === target) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of edges.get(n) ?? []) stack.push(m);
  }
  return false;
}

export async function setDependencies(lp: LoadedProject, task: TaskRow, dependsOn: number[]) {
  if (!canEditTask(lp.ctx, relOf(task))) throw forbidden("Không có quyền sửa việc này");
  const ids = [...new Set(dependsOn)];
  if (ids.includes(task.id)) throw badRequest("Việc không phụ thuộc vào chính nó");
  if (ids.length) {
    // Cộng tác chỉ trỏ tới việc mình thấy được (không dò được id việc khác qua 400/200).
    const n = await prisma.task.count({ where: { AND: [{ id: { in: ids }, projectId: lp.project.id }, taskVisibilityWhere(lp.ctx)] } });
    if (n !== ids.length) throw badRequest("Việc phụ thuộc phải cùng dự án");
  }
  await withLock(`task-deps:${lp.project.id}`, async () => {
    const all = await prisma.taskDependency.findMany({ where: { task: { projectId: lp.project.id }, NOT: { taskId: task.id } } });
    const edges = new Map<number, number[]>();
    for (const e of all) edges.set(e.taskId, [...(edges.get(e.taskId) ?? []), e.dependsOnId]);
    edges.set(task.id, ids);
    if (ids.some((d) => reaches(edges, d, task.id))) throw badRequest("Phụ thuộc tạo thành vòng lặp (A chờ B, B lại chờ A)");
    await prisma.$transaction([
      prisma.taskDependency.deleteMany({ where: { taskId: task.id } }),
      prisma.taskDependency.createMany({ data: ids.map((dependsOnId) => ({ taskId: task.id, dependsOnId })) }),
    ]);
  });
  return getRow(task.id);
}

export async function deleteTask(lp: LoadedProject, task: Task) {
  if (!canDeleteTask(lp.ctx)) throw forbidden("Chỉ quản lý dự án được xóa việc");
  await prisma.task.delete({ where: { id: task.id } });
}

/** Mã NV được nhắc trong bình luận: "@NV007" (theo mã, không theo tên — tên trùng nhau được). */
export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([A-Za-z][A-Za-z0-9_-]{1,19})\b/g)) out.add(m[1].toUpperCase());
  return [...out];
}

export async function listComments(lp: LoadedProject, taskId: number): Promise<CommentDto[]> {
  const [rows, snaps] = await Promise.all([prisma.taskComment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" }, take: 500 }), can(lp.user, "snapshots.view")]);
  const authors = await prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: PERSON_SELECT });
  const byId = new Map(authors.map((a) => [a.id, toPersonDto(lp.user, a, snaps)]));
  return rows.map((r) => ({ id: r.id, taskId: r.taskId, text: r.text, createdAt: r.createdAt.toISOString(), author: byId.get(r.authorId) ?? null, mentions: parseIdList(r.mentions) }));
}

/** Thêm bình luận. Người được nhắc = thành viên dự án THẤY được việc này. */
export async function addComment(lp: LoadedProject, task: TaskRow, text: string) {
  if (!canComment(lp.ctx, relOf(task))) throw forbidden("Không có quyền bình luận");
  const codes = parseMentions(text);
  const members = codes.length
    ? await prisma.projectMember.findMany({ where: { projectId: lp.project.id, employee: { code: { in: codes }, active: true } }, select: { employeeId: true, role: true } })
    : [];
  const rel = relOf(task);
  const mentions = members
    .filter((m) => m.employeeId !== lp.user.id)
    .filter((m) => canViewTask({ userId: m.employeeId, systemRole: "", manageAll: false, memberRole: m.role as ProjectCtx["memberRole"] }, rel))
    .map((m) => m.employeeId);
  const comment = await prisma.taskComment.create({ data: { taskId: task.id, authorId: lp.user.id, text, mentions: JSON.stringify(mentions) } });
  await prisma.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
  return { comment, mentions };
}
