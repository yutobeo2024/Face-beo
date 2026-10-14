// v1.23.0: bảng chân trị luật phân quyền phân hệ Công việc (src/lib/tasks/project-access.ts).
import { describe, expect, it } from "vitest";
import {
  canAssignTask,
  canCreateTask,
  canDeleteTask,
  canEditTask,
  canManageProject,
  canOwnProject,
  canSetMember,
  canViewProject,
  canViewTask,
  effectiveRole,
  permsDto,
  taskVisibilityWhere,
  type ProjectCtx,
} from "@/lib/tasks/project-access";
import type { ProjectRole } from "@/lib/tasks/types";

const ME = 10;
const OTHER = 20;
const ctx = (memberRole: ProjectRole | null, o: Partial<ProjectCtx> = {}): ProjectCtx => ({ userId: ME, systemRole: "EMPLOYEE", manageAll: false, memberRole, ...o });
const mine = { createdById: ME, assigneeIds: [] };
const assigned = { createdById: OTHER, assigneeIds: [ME] };
const foreign = { createdById: OTHER, assigneeIds: [OTHER] };

describe("vai trò hiệu lực", () => {
  it("Quản trị hệ thống = Chủ dự án dù không là thành viên (chủ nghỉ việc vẫn có người xử lý)", () => {
    expect(effectiveRole(ctx(null, { systemRole: "ADMIN" }))).toBe("OWNER");
  });
  it("tasks.manageAll không là thành viên ⇒ Quản lý dự án; là Cộng tác ⇒ vẫn nâng lên Quản lý dự án", () => {
    expect(effectiveRole(ctx(null, { manageAll: true }))).toBe("ADMIN");
    expect(effectiveRole(ctx("CONTRIBUTOR", { manageAll: true }))).toBe("ADMIN");
    expect(effectiveRole(ctx("OWNER", { manageAll: true }))).toBe("OWNER");
  });
  it("không là thành viên ⇒ không thấy dự án", () => {
    expect(effectiveRole(ctx(null))).toBeNull();
    expect(canViewProject(ctx(null))).toBe(false);
    expect(canCreateTask(ctx(null))).toBe(false);
  });
});

describe("bảng chân trị 4 vai trò × tự tạo / được giao / không liên quan", () => {
  const table: [ProjectRole, { view: boolean[]; edit: boolean[]; del: boolean; manage: boolean; own: boolean }][] = [
    ["OWNER", { view: [true, true, true], edit: [true, true, true], del: true, manage: true, own: true }],
    ["ADMIN", { view: [true, true, true], edit: [true, true, true], del: true, manage: true, own: false }],
    ["MEMBER", { view: [true, true, true], edit: [true, true, false], del: false, manage: false, own: false }],
    ["CONTRIBUTOR", { view: [true, true, false], edit: [true, true, false], del: false, manage: false, own: false }],
  ];
  for (const [role, exp] of table) {
    it(role, () => {
      const c = ctx(role);
      expect([mine, assigned, foreign].map((t) => canViewTask(c, t))).toEqual(exp.view);
      expect([mine, assigned, foreign].map((t) => canEditTask(c, t))).toEqual(exp.edit);
      expect(canDeleteTask(c)).toBe(exp.del);
      expect(canManageProject(c)).toBe(exp.manage);
      expect(canOwnProject(c)).toBe(exp.own);
      expect(canCreateTask(c)).toBe(true);
    });
  }
  it("Cộng tác: danh sách chỉ lọc việc tự tạo / được giao; Thành viên trở lên thấy hết", () => {
    expect(taskVisibilityWhere(ctx("CONTRIBUTOR"))).toEqual({ OR: [{ createdById: ME }, { assignees: { some: { employeeId: ME } } }] });
    expect(taskVisibilityWhere(ctx("MEMBER"))).toEqual({});
    expect(permsDto(ctx("CONTRIBUTOR")).seeAllTasks).toBe(false);
  });
});

describe("giao việc", () => {
  it("quản lý dự án giao mọi việc; thành viên chỉ giao việc mình tạo; cộng tác không giao cho người khác", () => {
    expect(canAssignTask(ctx("ADMIN"), foreign)).toBe(true);
    expect(canAssignTask(ctx("MEMBER"), mine)).toBe(true);
    expect(canAssignTask(ctx("MEMBER"), assigned)).toBe(false);
    expect(canAssignTask(ctx("CONTRIBUTOR"), mine)).toBe(false);
  });
});

describe("đổi vai trò thành viên", () => {
  it("không ai đặt / đổi / gỡ Chủ dự án qua đây (phải chuyển quyền sở hữu)", () => {
    expect(canSetMember(ctx("OWNER"), OTHER, null, "OWNER")).toBe(false);
    expect(canSetMember(ctx("OWNER"), OTHER, "OWNER", "MEMBER")).toBe(false);
    expect(canSetMember(ctx(null, { systemRole: "ADMIN" }), OTHER, "OWNER", null)).toBe(false);
  });
  it("Quản lý dự án không hạ / gỡ Quản lý dự án khác, nhưng tự hạ mình được; Chủ dự án thì được", () => {
    expect(canSetMember(ctx("ADMIN"), OTHER, "ADMIN", "MEMBER")).toBe(false);
    expect(canSetMember(ctx("ADMIN"), OTHER, "ADMIN", null)).toBe(false);
    expect(canSetMember(ctx("ADMIN"), ME, "ADMIN", "MEMBER")).toBe(true);
    expect(canSetMember(ctx("ADMIN"), OTHER, "MEMBER", "ADMIN")).toBe(true);
    expect(canSetMember(ctx("OWNER"), OTHER, "ADMIN", "CONTRIBUTOR")).toBe(true);
  });
  it("Thành viên / Cộng tác không đổi vai trò ai", () => {
    expect(canSetMember(ctx("MEMBER"), OTHER, null, "CONTRIBUTOR")).toBe(false);
    expect(canSetMember(ctx("CONTRIBUTOR"), OTHER, null, "CONTRIBUTOR")).toBe(false);
  });
});
