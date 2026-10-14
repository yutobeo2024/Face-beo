/**
 * Luật phân quyền phân hệ Công việc — HÀM THUẦN, kiểm ở server cho MỌI thao tác (client chỉ nhận cờ để ẩn/hiện nút).
 *
 * Hai lớp: capability hệ thống (tasks.use / tasks.createProject / tasks.manageAll, ma trận RolePermission) + vai trò trong
 * dự án (ProjectMember.role). Viết lại từ Permission_Analysis.md của TeamTask, sửa các lỗ của bản cũ:
 *  - CONTRIBUTOR chỉ thấy / sửa việc được giao hoặc tự tạo (việc khác ⇒ 404, không lộ tồn tại).
 *  - MEMBER thấy mọi việc, sửa việc mình tạo / được giao, KHÔNG xóa.
 *  - ADMIN / OWNER dự án toàn quyền việc + thành viên + Zalo; chỉ OWNER đổi tên, xóa / khôi phục, chuyển quyền sở hữu.
 *  - ADMIN dự án không hạ / gỡ ADMIN khác (và không đụng OWNER).
 *  - Người có tasks.manageAll mà không là thành viên ⇒ coi như ADMIN dự án; Quản trị hệ thống ⇒ coi như OWNER
 *    (xử lý khi chủ dự án nghỉ việc).
 */
import type { ProjectPerms, ProjectRole, TaskPerms } from "./types";

export type ProjectCtx = {
  userId: number;
  systemRole: string;
  manageAll: boolean;
  memberRole: ProjectRole | null;
};

export type TaskRel = { createdById: number; assigneeIds: number[] };

const RANK: Record<ProjectRole, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, CONTRIBUTOR: 1 };

export function effectiveRole(ctx: ProjectCtx): ProjectRole | null {
  if (ctx.systemRole === "ADMIN") return "OWNER";
  const own = ctx.memberRole;
  if (ctx.manageAll && (!own || RANK[own] < RANK.ADMIN)) return "ADMIN";
  return own;
}

const rank = (ctx: ProjectCtx) => {
  const r = effectiveRole(ctx);
  return r ? RANK[r] : 0;
};

export const canViewProject = (ctx: ProjectCtx) => rank(ctx) > 0;
/** Thành viên, nhóm Zalo, mô tả / màu dự án. */
export const canManageProject = (ctx: ProjectCtx) => rank(ctx) >= RANK.ADMIN;
/** Đổi tên, xóa / khôi phục, chuyển quyền sở hữu. */
export const canOwnProject = (ctx: ProjectCtx) => effectiveRole(ctx) === "OWNER";
export const canCreateTask = (ctx: ProjectCtx) => rank(ctx) >= RANK.CONTRIBUTOR;
export const canSeeAllTasks = (ctx: ProjectCtx) => rank(ctx) >= RANK.MEMBER;

const involved = (ctx: ProjectCtx, t: TaskRel) => t.createdById === ctx.userId || t.assigneeIds.includes(ctx.userId);

export const canViewTask = (ctx: ProjectCtx, t: TaskRel) => canSeeAllTasks(ctx) || (canViewProject(ctx) && involved(ctx, t));
export const canEditTask = (ctx: ProjectCtx, t: TaskRel) => canManageProject(ctx) || (canViewProject(ctx) && involved(ctx, t));
export const canDeleteTask = (ctx: ProjectCtx) => canManageProject(ctx);
/** Đổi người được giao: quản lý dự án, hoặc người tạo việc (thành viên trở lên). */
export const canAssignTask = (ctx: ProjectCtx, t: TaskRel) => canManageProject(ctx) || (canSeeAllTasks(ctx) && t.createdById === ctx.userId);
export const canComment = (ctx: ProjectCtx, t: TaskRel) => canViewTask(ctx, t);

/**
 * Đặt / đổi vai trò một thành viên (không gồm OWNER — đổi chủ qua transferOwner).
 * `current` = vai trò hiện tại của người bị đổi (null = chưa là thành viên), `next` = vai trò mới (null = gỡ khỏi dự án).
 */
export function canSetMember(ctx: ProjectCtx, targetId: number, current: ProjectRole | null, next: ProjectRole | null): boolean {
  if (!canManageProject(ctx)) return false;
  if (next === "OWNER" || current === "OWNER") return false;
  if (canOwnProject(ctx)) return true;
  // ADMIN dự án: không hạ / gỡ ADMIN khác; tự rời / tự hạ mình thì được.
  if (current === "ADMIN" && targetId !== ctx.userId) return false;
  return true;
}

/** Lọc danh sách việc theo quyền (ghép bằng AND với điều kiện khác). */
export function taskVisibilityWhere(ctx: ProjectCtx) {
  if (canSeeAllTasks(ctx)) return {};
  return { OR: [{ createdById: ctx.userId }, { assignees: { some: { employeeId: ctx.userId } } }] };
}

export function permsDto(ctx: ProjectCtx): ProjectPerms {
  return {
    role: effectiveRole(ctx),
    manage: canManageProject(ctx),
    own: canOwnProject(ctx),
    createTask: canCreateTask(ctx),
    deleteTask: canDeleteTask(ctx),
    seeAllTasks: canSeeAllTasks(ctx),
    restore: canOwnProject(ctx) || ctx.manageAll,
  };
}

export function taskPermsDto(ctx: ProjectCtx, t: TaskRel): TaskPerms {
  return { edit: canEditTask(ctx, t), delete: canDeleteTask(ctx), assign: canAssignTask(ctx, t), comment: canComment(ctx, t) };
}
