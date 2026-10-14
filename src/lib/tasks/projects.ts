/**
 * Dự án & thành viên (v1.23.0). Mọi route có dự án đi qua `loadProjectCtx` — dự án không thấy ⇒ 404 (không lộ tồn tại).
 * Bất biến: `Project.ownerId` luôn có dòng ProjectMember OWNER tương ứng; chỉ `transferOwner` đổi chủ.
 */
import type { Prisma, Project } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, forbidden, notFound } from "../api";
import type { AuthUser } from "../auth";
import { can } from "../permissions";
import { displayAvatarUrl } from "../profile-photo";
import { canManageProject, canOwnProject, canSetMember, canViewProject, type ProjectCtx } from "./project-access";
import { parseZaloPrefs } from "./schemas";
import { DEFAULT_ZALO_PREFS, PROJECT_COLORS, type MemberDto, type PersonDto, type ProjectColor, type ProjectDto, type ProjectRole, type ZaloPrefs } from "./types";

export type LoadedProject = { project: Project; ctx: ProjectCtx; user: AuthUser };

/** Dự án người dùng được thấy trong danh sách (đã xóa mềm thì không, trừ khi `deleted`). */
export function projectsScopeWhere(u: AuthUser, manageAll: boolean, deleted = false): Prisma.ProjectWhereInput {
  const del = deleted ? { deletedAt: { not: null } } : { deletedAt: null };
  if (manageAll || u.role === "ADMIN") return del;
  return { ...del, members: { some: { employeeId: u.id } } };
}

export async function projectCtxFor(u: AuthUser, projectId: number, manageAll?: boolean): Promise<ProjectCtx> {
  const [all, m] = await Promise.all([
    manageAll ?? can(u, "tasks.manageAll"),
    prisma.projectMember.findUnique({ where: { projectId_employeeId: { projectId, employeeId: u.id } }, select: { role: true } }),
  ]);
  return { userId: u.id, systemRole: u.role, manageAll: all, memberRole: (m?.role as ProjectRole | undefined) ?? null };
}

/** Nạp dự án + quyền. Dự án đã xóa mềm chỉ mở được khi `allowDeleted` (để khôi phục) và người đó là chủ / Quản trị. */
export async function loadProjectCtx(u: AuthUser, projectId: number, opts: { allowDeleted?: boolean } = {}): Promise<LoadedProject> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Không tìm thấy dự án");
  const ctx = await projectCtxFor(u, projectId);
  if (!canViewProject(ctx)) throw notFound("Không tìm thấy dự án");
  if (project.deletedAt && !(opts.allowDeleted && (canOwnProject(ctx) || ctx.manageAll))) throw notFound("Không tìm thấy dự án");
  return { project, ctx, user: u };
}

const colorOf = (c: string): ProjectColor => (c in PROJECT_COLORS ? (c as ProjectColor) : "blue");

export function toProjectDto(p: Project, myRole: ProjectRole | null, counts?: ProjectDto["counts"]): ProjectDto {
  return {
    id: p.id,
    name: p.name,
    color: colorOf(p.color),
    description: p.description,
    ownerId: p.ownerId,
    zaloGroupId: p.zaloGroupId,
    zaloPrefs: parseZaloPrefs(p.zaloPrefs),
    deletedAt: p.deletedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    myRole,
    counts,
  };
}

export const PERSON_SELECT = { id: true, code: true, name: true, active: true, departmentId: true, faceAvatarKey: true, faceAvatarAt: true, photoKey: true, photoAt: true } as const;
type PersonRow = Prisma.EmployeeGetPayload<{ select: typeof PERSON_SELECT }>;

/** DTO người: CHỈ id, mã, tên, ảnh, còn làm — không SĐT / phòng / dữ liệu cá nhân. */
export function toPersonDto(u: AuthUser, e: PersonRow, canSnapshots: boolean): PersonDto {
  return { id: e.id, code: e.code, name: e.name, active: e.active, avatarUrl: displayAvatarUrl(u, e, canSnapshots) };
}

export async function listMembers(u: AuthUser, projectId: number): Promise<MemberDto[]> {
  const [rows, snaps] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId }, include: { employee: { select: PERSON_SELECT } } }),
    can(u, "snapshots.view"),
  ]);
  const order: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, CONTRIBUTOR: 3 };
  return rows
    .map((r) => ({ ...toPersonDto(u, r.employee, snaps), role: r.role as ProjectRole }))
    .sort((a, b) => order[a.role] - order[b.role] || a.code.localeCompare(b.code));
}

/** Nhóm Zalo phải có trong danh sách đã cấu hình (Cấu hình → Zalo). */
async function assertZaloGroup(groupId: string | null | undefined) {
  if (!groupId) return;
  if (!(await prisma.zaloGroup.findUnique({ where: { groupId }, select: { groupId: true } }))) throw badRequest("Nhóm Zalo không có trong danh sách đã cấu hình");
}

export async function createProject(
  u: AuthUser,
  body: { name: string; color: string; description: string; zaloGroupId: string | null; zaloPrefs?: ZaloPrefs },
): Promise<Project> {
  await assertZaloGroup(body.zaloGroupId);
  return prisma.project.create({
    data: {
      name: body.name,
      color: colorOf(body.color),
      description: body.description,
      zaloGroupId: body.zaloGroupId,
      zaloPrefs: JSON.stringify(body.zaloPrefs ?? DEFAULT_ZALO_PREFS),
      ownerId: u.id,
      createdById: u.id,
      members: { create: { employeeId: u.id, role: "OWNER", addedById: u.id } },
    },
  });
}

export async function updateProject(
  lp: LoadedProject,
  body: { name?: string; color?: string; description?: string; zaloGroupId?: string | null; zaloPrefs?: Partial<ZaloPrefs> },
): Promise<Project> {
  if (!canManageProject(lp.ctx)) throw forbidden("Chỉ quản lý dự án được sửa");
  if (body.name !== undefined && body.name !== lp.project.name && !canOwnProject(lp.ctx)) throw forbidden("Chỉ chủ dự án được đổi tên");
  // Chỉ kiểm / chỉ chặn khi THẬT SỰ đổi nhóm (nhóm cũ bị gỡ khỏi Cấu hình không được làm hỏng mọi lần lưu khác).
  const groupChanged = body.zaloGroupId !== undefined && (body.zaloGroupId || null) !== lp.project.zaloGroupId;
  if (groupChanged) {
    // Quản lý dự án chỉ có tasks.use (vd. nhân viên được nâng) không được trỏ tin dự án vào nhóm bất kỳ (nhóm Nhân sự, minh bạch…).
    if (!(await canPickZaloGroup(lp))) throw forbidden("Chỉ người có quyền tạo dự án / quản lý mọi dự án được đổi nhóm Zalo");
    await assertZaloGroup(body.zaloGroupId);
  }
  const data: Prisma.ProjectUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.color !== undefined) data.color = colorOf(body.color);
  if (body.description !== undefined) data.description = body.description;
  if (groupChanged) data.zaloGroupId = body.zaloGroupId || null;
  if (body.zaloPrefs) data.zaloPrefs = JSON.stringify({ ...parseZaloPrefs(lp.project.zaloPrefs), ...body.zaloPrefs });
  return prisma.project.update({ where: { id: lp.project.id }, data });
}

/** Đổi nhóm Zalo của dự án: Quản lý dự án VÀ có quyền tạo dự án / quản lý mọi dự án (Quản trị luôn được). */
export async function canPickZaloGroup(lp: LoadedProject) {
  if (!canManageProject(lp.ctx)) return false;
  return lp.ctx.systemRole === "ADMIN" || lp.ctx.manageAll || can(lp.user, "tasks.createProject");
}

export async function softDeleteProject(lp: LoadedProject) {
  if (!canOwnProject(lp.ctx)) throw forbidden("Chỉ chủ dự án được xóa");
  const r = await prisma.project.updateMany({ where: { id: lp.project.id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count === 0) throw badRequest("Dự án đã bị xóa");
}

export async function restoreProject(lp: LoadedProject) {
  if (!(canOwnProject(lp.ctx) || lp.ctx.manageAll)) throw forbidden("Chỉ chủ dự án được khôi phục");
  const r = await prisma.project.updateMany({ where: { id: lp.project.id, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (r.count === 0) throw badRequest("Dự án chưa bị xóa");
}

/** Thêm / đổi vai trò nhiều thành viên. Chỉ nhân viên đang làm; không đụng OWNER. Trả về id người MỚI được thêm. */
export async function setMembers(lp: LoadedProject, items: { employeeId: number; role: ProjectRole }[]): Promise<number[]> {
  const ids = [...new Set(items.map((i) => i.employeeId))];
  if (ids.length !== items.length) throw badRequest("Danh sách thành viên bị trùng");
  const [emps, current] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } }),
    prisma.projectMember.findMany({ where: { projectId: lp.project.id, employeeId: { in: ids } } }),
  ]);
  if (emps.length !== ids.length) throw badRequest("Có nhân viên không tồn tại hoặc đã nghỉ việc");
  const cur = new Map(current.map((m) => [m.employeeId, m.role as ProjectRole]));
  for (const it of items) {
    if (!canSetMember(lp.ctx, it.employeeId, cur.get(it.employeeId) ?? null, it.role)) throw forbidden("Không đủ quyền đổi vai trò thành viên này");
  }
  await prisma.$transaction(
    items.map((it) =>
      prisma.projectMember.upsert({
        where: { projectId_employeeId: { projectId: lp.project.id, employeeId: it.employeeId } },
        create: { projectId: lp.project.id, employeeId: it.employeeId, role: it.role, addedById: lp.user.id },
        update: { role: it.role },
      }),
    ),
  );
  return ids.filter((id) => !cur.has(id));
}

/** Gỡ thành viên: gỡ luôn khỏi danh sách người được giao của các việc trong dự án. */
export async function removeMember(lp: LoadedProject, employeeId: number) {
  const m = await prisma.projectMember.findUnique({ where: { projectId_employeeId: { projectId: lp.project.id, employeeId } } });
  if (!m) throw notFound("Người này không là thành viên");
  // Tự rời dự án thì được (trừ chủ dự án — phải chuyển quyền trước).
  const self = employeeId === lp.user.id && m.role !== "OWNER";
  if (!self && !canSetMember(lp.ctx, employeeId, m.role as ProjectRole, null)) {
    throw m.role === "OWNER" ? badRequest("Không gỡ được chủ dự án — hãy chuyển quyền sở hữu trước") : forbidden("Không đủ quyền gỡ thành viên này");
  }
  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { employeeId, task: { projectId: lp.project.id } } }),
    prisma.projectMember.delete({ where: { projectId_employeeId: { projectId: lp.project.id, employeeId } } }),
  ]);
  return m;
}

/** Chuyển quyền sở hữu: chủ cũ thành Quản lý dự án, người mới (phải là thành viên, đang làm) thành Chủ dự án. */
export async function transferOwner(lp: LoadedProject, employeeId: number) {
  if (!canOwnProject(lp.ctx)) throw forbidden("Chỉ chủ dự án được chuyển quyền sở hữu");
  const oldOwner = lp.project.ownerId;
  if (employeeId === oldOwner) throw badRequest("Người này đã là chủ dự án");
  const m = await prisma.projectMember.findUnique({
    where: { projectId_employeeId: { projectId: lp.project.id, employeeId } },
    include: { employee: { select: { active: true } } },
  });
  if (!m || !m.employee.active) throw badRequest("Người nhận phải là thành viên đang làm việc của dự án");
  await prisma.$transaction(async (tx) => {
    const r = await tx.project.updateMany({ where: { id: lp.project.id, ownerId: oldOwner }, data: { ownerId: employeeId } });
    if (r.count === 0) throw badRequest("Chủ dự án vừa thay đổi — tải lại trang");
    await tx.projectMember.updateMany({ where: { projectId: lp.project.id, employeeId: oldOwner }, data: { role: "ADMIN" } });
    await tx.projectMember.update({ where: { projectId_employeeId: { projectId: lp.project.id, employeeId } }, data: { role: "OWNER" } });
  });
  return { from: oldOwner, to: employeeId };
}

/** Đếm nhanh cho thẻ dự án (số việc, đã xong, quá hạn, thành viên). `onlyFor` = chỉ đếm việc người đó tạo / được giao (Cộng tác). */
export async function projectCounts(projectIds: number[], now = new Date(), onlyFor?: number) {
  if (!projectIds.length) return new Map<number, NonNullable<ProjectDto["counts"]>>();
  const mine: Prisma.TaskWhereInput = onlyFor ? { OR: [{ createdById: onlyFor }, { assignees: { some: { employeeId: onlyFor } } }] } : {};
  const [total, done, overdue, members] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, ...mine }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, status: "DONE", ...mine }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, status: { not: "DONE" }, dueAt: { lt: now }, ...mine }, _count: { _all: true } }),
    prisma.projectMember.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds } }, _count: { _all: true } }),
  ]);
  const get = (rows: { projectId: number; _count: { _all: number } }[], id: number) => rows.find((r) => r.projectId === id)?._count._all ?? 0;
  return new Map(projectIds.map((id) => [id, { total: get(total, id), done: get(done, id), overdue: get(overdue, id), members: get(members, id) }]));
}
