/**
 * Thông báo phân hệ Công việc: chuông trong app (InAppNotification) + Zalo.
 *  - Tin NHÓM đi thẳng `Project.zaloGroupId` (không qua category / announce()), chỉ khi dự án bật cờ tương ứng.
 *  - Tin chỉ có tiêu đề / tên / trạng thái / hạn — KHÔNG mô tả, không nội dung bình luận, không dữ liệu cá nhân.
 *  - Không bao giờ ném lỗi ra route (thông báo hỏng không được làm hỏng thao tác chính).
 */
import { Prisma, type Project } from "@prisma/client";
import { prisma } from "../db";
import { fmtDT } from "../notify";
import { sendZaloMessage } from "../zalo-oa";
import type { MessageType } from "../zalo-templates";
import { parseZaloPrefs } from "./schemas";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type NotificationKind, type TaskPriority, type TaskStatus, type ZaloPrefKey } from "./types";

type Actor = { id: number; name: string };
type TaskLite = { id: number; projectId: number; title: string; priority: string; dueAt: Date; createdById: number; assignees: { employeeId: number; employee?: { name: string } }[] };

export type InAppRow = {
  employeeId: number;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  projectId?: number | null;
  taskId?: number | null;
  actorId?: number | null;
  dedupeKey?: string | null;
};

/** Lọc người nhận: chỉ nhân viên đang làm việc VÀ còn là thành viên dự án (người đã nghỉ / đã rời không nhận tin nữa). */
export async function currentMembers(projectId: number, ids: number[]): Promise<number[]> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const rows = await prisma.projectMember.findMany({ where: { projectId, employeeId: { in: uniq }, employee: { active: true } }, select: { employeeId: true } });
  const ok = new Set(rows.map((r) => r.employeeId));
  return uniq.filter((id) => ok.has(id));
}

/** Ghi chuông; trùng dedupeKey thì bỏ qua (chạy lại job không nhân đôi). Trả về số dòng ghi được. */
export async function pushInApp(rows: InAppRow[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    try {
      await prisma.inAppNotification.create({ data: { ...r, body: r.body ?? null } });
      n++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      console.error("[tasks] ghi thông báo lỗi:", (e as Error).message);
    }
  }
  return n;
}

/** Gửi tin nhóm của dự án nếu có nhóm + bật cờ. */
export async function zaloGroup(project: Pick<Project, "id" | "zaloGroupId" | "zaloPrefs">, pref: ZaloPrefKey, messageType: MessageType, data: Record<string, unknown>, dedupeKey: string) {
  if (!project.zaloGroupId || !parseZaloPrefs(project.zaloPrefs)[pref]) return null;
  return sendZaloMessage({ toGroupId: project.zaloGroupId, messageType, data: { projectId: project.id, ...data }, dedupeKey: `${dedupeKey}@${project.zaloGroupId}` });
}

const assigneeNames = async (t: TaskLite) => {
  const ids = t.assignees.map((a) => a.employeeId);
  if (!ids.length) return "";
  if (t.assignees.every((a) => a.employee)) return t.assignees.map((a) => a.employee!.name).join(", ");
  return (await prisma.employee.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((e) => e.name).join(", ");
};

/** Người liên quan tới việc (người được giao + người tạo) còn trong dự án, bỏ người thao tác. */
const involved = (t: TaskLite, actorId: number) => currentMembers(t.projectId, [...t.assignees.map((a) => a.employeeId), t.createdById].filter((id) => id !== actorId));

async function safe(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[tasks] ${label} lỗi:`, (e as Error).message);
  }
}

export function notifyTaskCreated(project: Project, t: TaskLite, actor: Actor) {
  return safe("thông báo việc mới", async () => {
    const to = await currentMembers(project.id, t.assignees.map((a) => a.employeeId).filter((id) => id !== actor.id));
    await pushInApp(
      to.map((employeeId) => ({
        employeeId,
        kind: "TASK_ASSIGNED" as const,
        title: `${actor.name} giao cho bạn: ${t.title}`,
        body: `${project.name} · hạn ${fmtDT(t.dueAt)}`,
        projectId: project.id,
        taskId: t.id,
        actorId: actor.id,
        dedupeKey: `task-assigned:${t.id}:${employeeId}:new`,
      })),
    );
    await zaloGroup(
      project,
      "onNewTask",
      "TASK_NEW",
      { projectName: project.name, title: t.title, taskId: t.id, priorityLabel: TASK_PRIORITY_LABEL[t.priority as TaskPriority] ?? t.priority, dueText: fmtDT(t.dueAt), assigneeNames: await assigneeNames(t), actorName: actor.name },
      `task-new:${t.id}`,
    );
  });
}

export function notifyAssigned(project: Project, t: TaskLite, actor: Actor, added: number[]) {
  const at = Date.now();
  return safe("thông báo giao việc", () =>
    pushInApp(
      added
        .filter((id) => id !== actor.id)
        .map((employeeId) => ({
          employeeId,
          kind: "TASK_ASSIGNED" as const,
          title: `${actor.name} giao cho bạn: ${t.title}`,
          body: `${project.name} · hạn ${fmtDT(t.dueAt)}`,
          projectId: project.id,
          taskId: t.id,
          actorId: actor.id,
          dedupeKey: `task-assigned:${t.id}:${employeeId}:${at}`,
        })),
    ),
  );
}

export function notifyStatusChanged(project: Project, t: TaskLite, from: TaskStatus, to: TaskStatus, actor: Actor) {
  const at = Date.now();
  return safe("thông báo đổi trạng thái", async () => {
    const fromLabel = TASK_STATUS_LABEL[from];
    const toLabel = TASK_STATUS_LABEL[to];
    await pushInApp(
      (await involved(t, actor.id)).map((employeeId) => ({
        employeeId,
        kind: "TASK_STATUS" as const,
        title: `${t.title}: ${fromLabel} → ${toLabel}`,
        body: `${actor.name} · ${project.name}`,
        projectId: project.id,
        taskId: t.id,
        actorId: actor.id,
        dedupeKey: `task-status:${t.id}:${from}>${to}:${at}:${employeeId}`,
      })),
    );
    await zaloGroup(project, "onStatusChange", "TASK_STATUS", { projectName: project.name, title: t.title, taskId: t.id, fromLabel, toLabel, actorName: actor.name }, `task-status:${t.id}:${from}>${to}:${at}`);
  });
}

export function notifyComment(project: Project, t: TaskLite, commentId: number, mentions: number[], actor: Actor) {
  return safe("thông báo bình luận", async () => {
    const base = { projectId: project.id, taskId: t.id, actorId: actor.id };
    await pushInApp([
      ...mentions.map((employeeId) => ({
        ...base,
        employeeId,
        kind: "TASK_MENTION" as const,
        title: `${actor.name} nhắc đến bạn: ${t.title}`,
        body: project.name,
        dedupeKey: `task-mention:${commentId}:${employeeId}`,
      })),
      ...(await involved(t, actor.id))
        .filter((id) => !mentions.includes(id))
        .map((employeeId) => ({
          ...base,
          employeeId,
          kind: "TASK_COMMENT" as const,
          title: `${actor.name} bình luận: ${t.title}`,
          body: project.name,
          dedupeKey: `task-comment:${commentId}:${employeeId}`,
        })),
    ]);
    if (parseZaloPrefs(project.zaloPrefs).onUserMention) {
      for (const employeeId of mentions) {
        await sendZaloMessage({ toEmployeeId: employeeId, messageType: "TASK_MENTION", data: { projectId: project.id, projectName: project.name, title: t.title, taskId: t.id, actorName: actor.name }, dedupeKey: `task-mention:${commentId}:${employeeId}` });
      }
    }
    await zaloGroup(project, "onNewComment", "TASK_COMMENT", { projectName: project.name, title: t.title, taskId: t.id, actorName: actor.name }, `task-comment:${commentId}`);
  });
}

export function notifyMemberAdded(project: Project, added: number[], actor: Actor) {
  return safe("thông báo thêm thành viên", () =>
    pushInApp(
      added
        .filter((id) => id !== actor.id)
        .map((employeeId) => ({
          employeeId,
          kind: "PROJECT_MEMBER" as const,
          title: `${actor.name} thêm bạn vào dự án ${project.name}`,
          projectId: project.id,
          actorId: actor.id,
          dedupeKey: `project-member:${project.id}:${employeeId}:${Date.now()}`,
        })),
    ),
  );
}
