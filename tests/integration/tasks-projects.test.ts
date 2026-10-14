/** v1.23.0 — dự án: tạo, phạm vi xem (404), thành viên, chuyển quyền sở hữu, xóa mềm / khôi phục, nhóm Zalo. */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveMatrix } from "@/lib/permissions";
import { defaults, setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TP");
const P = (id: number) => ({ id: String(id) });

describe("tạo dự án", () => {
  it("Quản lý tạo được, người tạo là Chủ dự án; nhân viên (chỉ tasks.use) bị 403", async () => {
    const id = await f.project("MGR");
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, include: { members: true } });
    expect(p.ownerId).toBe(f.users.MGR);
    expect(p.members).toEqual([expect.objectContaining({ employeeId: f.users.MGR, role: "OWNER" })]);
    expect((await f.as("E1", "tasks/projects", "POST", { name: `${f.tag} x` })).status).toBe(403);
  });
  it("nhóm Zalo phải nằm trong danh sách đã cấu hình", async () => {
    expect((await f.as("MGR", "tasks/projects", "POST", { name: `${f.tag} z`, zaloGroupId: "khong-co" })).status).toBe(400);
    const id = await f.project("MGR", {}, { zaloGroupId: f.groupId });
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).zaloGroupId).toBe(f.groupId);
  });
});

describe("phạm vi xem", () => {
  it("người ngoài dự án: không có trong danh sách, GET → 404 (không lộ tồn tại); HR (manageAll) thấy", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    const list = async (who: "E1" | "E2" | "HR") => (await f.ok<{ projects: { id: number }[] }>(f.as(who, "tasks/projects"))).projects.map((p) => p.id);
    expect(await list("E1")).toContain(id);
    expect(await list("E2")).not.toContain(id);
    expect(await list("HR")).toContain(id);
    expect((await f.as("E2", "tasks/projects/[id]", "GET", undefined, P(id))).status).toBe(404);
    expect((await f.as("E2", "tasks/projects/[id]/tasks", "GET", undefined, P(id))).status).toBe(404);
    const hr = await f.ok<{ perms: { role: string; manage: boolean; own: boolean } }>(f.as("HR", "tasks/projects/[id]", "GET", undefined, P(id)));
    expect(hr.perms).toMatchObject({ role: "ADMIN", manage: true, own: false });
  });
  it("thu quyền tasks.use ⇒ 403 ở mọi route Công việc", async () => {
    await saveMatrix({ ...defaults(), EMPLOYEE: [] });
    try {
      expect((await f.as("E1", "tasks/projects")).status).toBe(403);
      expect((await f.as("E1", "tasks/my")).status).toBe(403);
    } finally {
      await saveMatrix(defaults());
    }
  });
});

describe("thành viên", () => {
  it("chỉ thêm nhân viên đang làm; Thành viên không thêm được ai; dữ liệu trả về không có SĐT", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    expect((await f.as("E1", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "MEMBER" }] }, P(id))).status).toBe(403);
    await prisma.employee.update({ where: { id: f.users.E4 }, data: { active: false } });
    try {
      expect((await f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E4, role: "MEMBER" }] }, P(id))).status).toBe(400);
    } finally {
      await prisma.employee.update({ where: { id: f.users.E4 }, data: { active: true } });
    }
    const { members } = await f.ok<{ members: Record<string, unknown>[] }>(
      f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "CONTRIBUTOR" }] }, P(id)),
    );
    expect(members.map((m) => m.role)).toEqual(["OWNER", "MEMBER", "CONTRIBUTOR"]);
    expect(Object.keys(members[0]).sort()).toEqual(["active", "avatarUrl", "code", "id", "name", "role"]);
    // Không ai đặt vai trò OWNER qua đây.
    expect((await f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "OWNER" }] }, P(id))).status).toBe(400);
  });
  it("Quản lý dự án không hạ / gỡ Quản lý dự án khác; Chủ dự án thì được", async () => {
    const id = await f.project("MGR", { E1: "ADMIN", E2: "ADMIN" });
    expect((await f.as("E1", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "MEMBER" }] }, P(id))).status).toBe(403);
    expect((await f.as("E1", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(id), employeeId: String(f.users.E2) })).status).toBe(403);
    expect((await f.as("E1", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(id), employeeId: String(f.users.MGR) })).status).toBe(400);
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(id), employeeId: String(f.users.E2) }));
  });
  it("gỡ thành viên thì gỡ luôn khỏi việc được giao", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    const t = await f.task("MGR", id, { assigneeIds: [f.users.E1] });
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(id), employeeId: String(f.users.E1) }));
    expect(await prisma.taskAssignee.count({ where: { taskId: t.id } })).toBe(0);
  });
  it("người được giao phải là thành viên dự án", async () => {
    const id = await f.project("MGR");
    expect((await f.as("MGR", "tasks/projects/[id]/tasks", "POST", { title: "x", dueAt: "2030-01-10T10:00:00.000Z", assigneeIds: [f.users.E3] }, P(id))).status).toBe(400);
  });
  it("kho nhân viên để thêm: chỉ quản lý dự án; chỉ id/mã/tên/phòng", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    expect((await f.as("E1", "tasks/members-pool", "GET", { projectId: String(id) })).status).toBe(403);
    const { people } = await f.ok<{ people: Record<string, unknown>[] }>(f.as("MGR", "tasks/members-pool", "GET", { projectId: String(id), q: f.tag }));
    expect(people.map((p) => p.id)).not.toContain(f.users.E1);
    expect(people.map((p) => p.id)).toContain(f.users.E2);
    expect(Object.keys(people[0]).sort()).toEqual(["code", "department", "id", "name"]);
  });
});

describe("chủ dự án", () => {
  it("chuyển quyền sở hữu: chủ cũ thành Quản lý dự án; chỉ chủ dự án chuyển được", async () => {
    const id = await f.project("MGR", { E1: "ADMIN", E2: "MEMBER" });
    expect((await f.as("E1", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E1 }, P(id))).status).toBe(403);
    expect((await f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E3 }, P(id))).status).toBe(400);
    await f.ok(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E2 }, P(id)));
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, include: { members: true } });
    expect(p.ownerId).toBe(f.users.E2);
    const role = (who: number) => p.members.find((m) => m.employeeId === who)?.role;
    expect([role(f.users.E2), role(f.users.MGR)]).toEqual(["OWNER", "ADMIN"]);
    expect(p.members.filter((m) => m.role === "OWNER")).toHaveLength(1);
  });
  it("chỉ chủ dự án đổi tên; Quản lý dự án sửa mô tả / màu / cờ Zalo", async () => {
    const id = await f.project("MGR", { E1: "ADMIN" });
    expect((await f.as("E1", "tasks/projects/[id]", "PATCH", { name: `${f.tag} tên mới` }, P(id))).status).toBe(403);
    await f.ok(f.as("E1", "tasks/projects/[id]", "PATCH", { description: "mô tả", color: "rose", zaloPrefs: { onNewComment: false } }, P(id)));
    const p = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect([p.description, p.color]).toEqual(["mô tả", "rose"]);
    expect(JSON.parse(p.zaloPrefs)).toMatchObject({ onNewComment: false, onNewTask: true });
  });
  it("đổi nhóm Zalo: Quản lý dự án chỉ có tasks.use (nhân viên được nâng) KHÔNG trỏ được tin dự án vào nhóm bất kỳ", async () => {
    const id = await f.project("MGR", { E1: "ADMIN" });
    expect((await f.as("E1", "tasks/projects/[id]", "PATCH", { zaloGroupId: f.groupId }, P(id))).status).toBe(403);
    expect((await f.as("E1", "tasks/zalo-groups", "GET", { projectId: String(id) })).status).toBe(403);
    const perms = (await f.ok<{ perms: { zaloGroup: boolean } }>(f.as("E1", "tasks/projects/[id]", "GET", undefined, P(id)))).perms;
    expect(perms.zaloGroup).toBe(false);
    await f.ok(f.as("MGR", "tasks/projects/[id]", "PATCH", { zaloGroupId: f.groupId }, P(id)));
    // Gửi lại đúng nhóm đang có (không đổi) thì không bị chặn — kể cả khi nhóm đã bị gỡ khỏi Cấu hình.
    await prisma.project.update({ where: { id }, data: { zaloGroupId: "nhom-da-go" } });
    await f.ok(f.as("E1", "tasks/projects/[id]", "PATCH", { zaloGroupId: "nhom-da-go", description: "vẫn lưu được" }, P(id)));
  });
  it("xóa mềm: biến khỏi danh sách, việc không mở được; chủ khôi phục từ thùng rác", async () => {
    const id = await f.project("MGR", { E1: "ADMIN" });
    const t = await f.task("MGR", id);
    expect((await f.as("E1", "tasks/projects/[id]", "DELETE", undefined, P(id))).status).toBe(403);
    await f.ok(f.as("MGR", "tasks/projects/[id]", "DELETE", undefined, P(id)));
    expect((await f.as("E1", "tasks/[id]", "GET", undefined, P(t.id))).status).toBe(404);
    const trash = await f.ok<{ projects: { id: number }[] }>(f.as("MGR", "tasks/projects", "GET", { deleted: "1" }));
    expect(trash.projects.map((p) => p.id)).toContain(id);
    expect((await f.as("E1", "tasks/projects/[id]/restore", "POST", undefined, P(id))).status).toBe(404);
    await f.ok(f.as("MGR", "tasks/projects/[id]/restore", "POST", undefined, P(id)));
    await f.ok(f.as("E1", "tasks/[id]", "GET", undefined, P(t.id)));
  });
  it("Quản trị hệ thống làm được việc của chủ dự án (chủ nghỉ việc)", async () => {
    const id = await f.project("MGR");
    await f.ok(f.as("ADMIN", "tasks/projects/[id]", "PATCH", { name: `${f.tag} đổi bởi QT` }, P(id)));
  });
  it("không xóa cứng được nhân viên đang có dự án / việc", async () => {
    await f.project("MGR", { E3: "MEMBER" });
    const r = await f.as("ADMIN", "employees/[id]", "DELETE", undefined, P(f.users.E3));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("dự án");
  });
  it("xóa nhóm Zalo khỏi Cấu hình ⇒ dự án thôi gắn nhóm đó", async () => {
    const gid = `${f.tag}-del`;
    await prisma.zaloGroup.create({ data: { groupId: gid, name: "tạm", source: "MANUAL" } });
    const id = await f.project("MGR", {}, { zaloGroupId: gid });
    await f.ok(f.as("ADMIN", "settings/zalo/groups/[groupId]", "DELETE", undefined, { groupId: gid }));
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).zaloGroupId).toBeNull();
    await prisma.notificationLog.deleteMany({ where: { toGroupId: gid } });
  });
});

describe("tổng quan (tasks.manageAll)", () => {
  it("HR xem được, Quản lý không", async () => {
    await f.project("MGR");
    const r = await f.ok<{ kpi: { projects: number } }>(f.as("HR", "tasks/overview"));
    expect(r.kpi.projects).toBeGreaterThan(0);
    expect((await f.as("MGR", "tasks/overview")).status).toBe(403);
  });
});
