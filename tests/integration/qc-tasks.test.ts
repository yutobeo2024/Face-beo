/**
 * QC v1.23.0 — Công việc: thử PHÁ phân hệ qua route handler thật. Giờ nghiệp vụ CỐ ĐỊNH (không dùng new Date()).
 * Vai trò mặc định trong mỗi dự án: MGR = Chủ dự án, E2 = Quản lý dự án, E1 = Thành viên, E3 = Cộng tác, E4 = người ngoài.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { vnDateTime } from "@/lib/attendance";
import { runJob } from "@/lib/jobs";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import { BASE, ctx as rctx, sessionCookie } from "./helpers";
import { setupTasksFixture, type Who } from "./tasks-fixture";

const f = setupTasksFixture("QC");
const P = (id: number) => ({ id: String(id) });
const PM = (id: number, emp: number) => ({ id: String(id), employeeId: String(emp) });
const st = async (r: Promise<Response>) => (await r).status;
const at = (d: string, t: string) => vnDateTime(d, t).toISOString();
const extraEmployees: number[] = [];

let pid = 0;
let tOwner: { id: number }; // MGR tạo, không giao ai
let tE3: { id: number }; // giao E3
let tE1: { id: number }; // E1 tạo

beforeAll(async () => {
  pid = await f.project("MGR", { E1: "MEMBER", E2: "ADMIN", E3: "CONTRIBUTOR" });
  tOwner = await f.task("MGR", pid, { title: `${f.tag} của chủ` });
  tE3 = await f.task("MGR", pid, { title: `${f.tag} giao E3`, assigneeIds: [f.users.E3] });
  tE1 = await f.task("E1", pid, { title: `${f.tag} E1 tạo` });
});

afterAll(async () => {
  if (!extraEmployees.length) return;
  await prisma.taskComment.deleteMany({ where: { authorId: { in: extraEmployees } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: extraEmployees } } });
  await prisma.employee.deleteMany({ where: { id: { in: extraEmployees } } });
});

/** Mọi route của một việc. */
const taskRoutes = (): [string, string, unknown][] => [
  ["tasks/[id]", "GET", undefined],
  ["tasks/[id]", "PATCH", { title: "hack" }],
  ["tasks/[id]", "DELETE", undefined],
  ["tasks/[id]/status", "POST", { status: "DONE" }],
  ["tasks/[id]/subtasks", "PUT", { subtasks: [{ text: "x", done: true }] }],
  ["tasks/[id]/dependencies", "PUT", { dependsOn: [] }],
  ["tasks/[id]/comments", "GET", undefined],
  ["tasks/[id]/comments", "POST", { text: "hack" }],
].map(([p, m, b]) => [p as string, m as string, b]) as [string, string, unknown][];

async function expectAllTaskRoutes(who: Who, id: number, status: number) {
  for (const [path, method, body] of taskRoutes()) {
    expect(await st(f.as(who, path, method, body, P(id))), `${who} ${method} ${path}`).toBe(status);
  }
}

describe("leo thang quyền — người ngoài / Cộng tác / Thành viên", () => {
  it("người ngoài dự án: MỌI route việc + dự án → 404 (không lộ tồn tại)", async () => {
    await expectAllTaskRoutes("E4", tOwner.id, 404);
    const routes: [string, string, unknown, Record<string, string>][] = [
      ["tasks/projects/[id]", "GET", undefined, P(pid)],
      ["tasks/projects/[id]", "PATCH", { description: "x" }, P(pid)],
      ["tasks/projects/[id]", "DELETE", undefined, P(pid)],
      ["tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E4, role: "ADMIN" }] }, P(pid)],
      ["tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(pid, f.users.E1)],
      ["tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E4 }, P(pid)],
      ["tasks/projects/[id]/restore", "POST", undefined, P(pid)],
      ["tasks/projects/[id]/tasks", "GET", undefined, P(pid)],
      ["tasks/projects/[id]/tasks", "POST", { title: "x", dueAt: "2030-01-10T10:00:00.000Z" }, P(pid)],
    ];
    for (const [path, method, body, params] of routes) expect(await st(f.as("E4", path, method, body, params)), `${method} ${path}`).toBe(404);
    expect(await st(f.as("E4", "tasks/members-pool", "GET", { projectId: String(pid) }))).toBe(404);
    expect(await st(f.as("E4", "tasks/zalo-groups", "GET", { projectId: String(pid) }))).toBe(404);
    expect(await prisma.projectMember.count({ where: { projectId: pid, employeeId: f.users.E4 } })).toBe(0);
  });

  it("Cộng tác: mọi route của việc không liên quan → 404 (kể cả DELETE / việc con / phụ thuộc), không phải 403", async () => {
    await expectAllTaskRoutes("E3", tOwner.id, 404);
    await expectAllTaskRoutes("E3", tE1.id, 404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: tOwner.id } })).title).toBe(`${f.tag} của chủ`);
  });

  it("Cộng tác / Thành viên: không sửa dự án, không thêm / gỡ / nâng ai (kể cả tự nâng mình), không chuyển chủ", async () => {
    for (const who of ["E1", "E3"] as const) {
      expect(await st(f.as(who, "tasks/projects/[id]", "PATCH", { description: "x" }, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]", "DELETE", undefined, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users[who], role: "ADMIN" }] }, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E4, role: "CONTRIBUTOR" }] }, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(pid, f.users.E2))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users[who] }, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/projects/[id]/restore", "POST", undefined, P(pid))), who).toBe(403);
      expect(await st(f.as(who, "tasks/members-pool", "GET", { projectId: String(pid) })), who).toBe(403);
      expect(await st(f.as(who, "tasks/zalo-groups", "GET", { projectId: String(pid) })), who).toBe(403);
      expect(await st(f.as(who, "tasks/overview")), who).toBe(403);
    }
    const roles = await prisma.projectMember.findMany({ where: { projectId: pid }, select: { employeeId: true, role: true } });
    expect(roles.find((r) => r.employeeId === f.users.E1)?.role).toBe("MEMBER");
    expect(roles.find((r) => r.employeeId === f.users.E3)?.role).toBe("CONTRIBUTOR");
  });

  it("Thành viên: thấy việc không liên quan nhưng không sửa việc con / phụ thuộc / xóa", async () => {
    await f.ok(f.as("E1", "tasks/[id]", "GET", undefined, P(tOwner.id)));
    expect(await st(f.as("E1", "tasks/[id]/subtasks", "PUT", { subtasks: [{ text: "x", done: true }] }, P(tOwner.id)))).toBe(403);
    expect(await st(f.as("E1", "tasks/[id]/dependencies", "PUT", { dependsOn: [tE1.id] }, P(tOwner.id)))).toBe(403);
    expect(await st(f.as("E1", "tasks/[id]", "DELETE", undefined, P(tOwner.id)))).toBe(403);
    expect(await prisma.subtask.count({ where: { taskId: tOwner.id } })).toBe(0);
  });

  it("Thành viên được giao (không phải người tạo): chỉ tự bỏ mình, không thêm / gỡ người khác", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1, f.users.E3] });
    expect(await st(f.as("E1", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E1, f.users.E3, f.users.E2] }, P(t.id)))).toBe(403);
    expect(await st(f.as("E1", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E1] }, P(t.id)))).toBe(403);
    await f.ok(f.as("E1", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E3] }, P(t.id)));
    const a = await prisma.taskAssignee.findMany({ where: { taskId: t.id } });
    expect(a.map((x) => x.employeeId)).toEqual([f.users.E3]);
  });

  it("Cộng tác không gài việc bí mật làm phụ thuộc để dò id (việc không thấy ⇒ không được dùng)", async () => {
    // E3 không thấy tOwner. Nếu đặt được, E3 biết tOwner tồn tại trong dự án (200 vs 400) — lộ tồn tại.
    const r = await f.as("E3", "tasks/[id]/dependencies", "PUT", { dependsOn: [tOwner.id] }, P(tE3.id));
    expect(r.status).not.toBe(200);
    expect(await prisma.taskDependency.count({ where: { taskId: tE3.id } })).toBe(0);
  });

  it("Cộng tác GET danh sách với ?assignee= người khác / ?status= vẫn chỉ ra việc của mình", async () => {
    const { tasks } = await f.ok<{ tasks: { id: number }[] }>(f.as("E3", "tasks/projects/[id]/tasks", "GET", { assignee: String(f.users.E1) }, P(pid)));
    expect(tasks).toEqual([]);
    const all = await f.ok<{ tasks: { id: number }[] }>(f.as("E3", "tasks/projects/[id]/tasks", "GET", { status: "TODO", q: f.tag }, P(pid)));
    expect(all.tasks.map((t) => t.id)).not.toContain(tOwner.id);
  });
});

describe("Quản lý dự án (ADMIN) không vượt Chủ dự án", () => {
  it("không đổi tên / xóa / chuyển chủ; không hạ / gỡ Chủ; không hạ / gỡ ADMIN khác; tự hạ mình được", async () => {
    const id = await f.project("MGR", { E1: "ADMIN", E2: "ADMIN", E3: "MEMBER" });
    expect(await st(f.as("E2", "tasks/projects/[id]", "PATCH", { name: `${f.tag} đổi` }, P(id)))).toBe(403);
    expect(await st(f.as("E2", "tasks/projects/[id]", "DELETE", undefined, P(id)))).toBe(403);
    expect(await st(f.as("E2", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E2 }, P(id)))).toBe(403);
    expect(await st(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.MGR, role: "MEMBER" }] }, P(id)))).toBe(403);
    expect(await st(f.as("E2", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.MGR)))).toBe(400);
    // Gói hai thay đổi: tự hạ mình (được) + hạ ADMIN khác (không) ⇒ cả gói bị từ chối, không đổi gì.
    expect(
      await st(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "MEMBER" }, { employeeId: f.users.E1, role: "MEMBER" }] }, P(id))),
    ).toBe(403);
    const role = async (e: number) => (await prisma.projectMember.findUniqueOrThrow({ where: { projectId_employeeId: { projectId: id, employeeId: e } } })).role;
    expect([await role(f.users.E1), await role(f.users.E2)]).toEqual(["ADMIN", "ADMIN"]);
    // Nâng MEMBER lên ADMIN được; sau đó không hạ lại được người đó.
    await f.ok(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E3, role: "ADMIN" }] }, P(id)));
    expect(await st(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E3, role: "MEMBER" }] }, P(id)))).toBe(403);
    await f.ok(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "CONTRIBUTOR" }] }, P(id)));
    expect(await role(f.users.E2)).toBe("CONTRIBUTOR");
    // Đã hạ xuống Cộng tác ⇒ hết quyền quản lý.
    expect(await st(f.as("E2", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "ADMIN" }] }, P(id)))).toBe(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(f.users.MGR);
  });

  it("PATCH dự án kèm ownerId / deletedAt / createdById: bị bỏ qua, chủ không đổi", async () => {
    const id = await f.project("MGR", { E2: "ADMIN" });
    await f.ok(f.as("E2", "tasks/projects/[id]", "PATCH", { ownerId: f.users.E2, createdById: f.users.E2, deletedAt: "2030-01-01T00:00:00.000Z", description: "d" }, P(id)));
    const p = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect([p.ownerId, p.createdById, p.deletedAt, p.description]).toEqual([f.users.MGR, f.users.MGR, null, "d"]);
  });

  it("HR (tasks.manageAll, không là thành viên): không đổi tên, không chuyển chủ, không hạ ADMIN dự án", async () => {
    const id = await f.project("MGR", { E2: "ADMIN" });
    expect(await st(f.as("HR", "tasks/projects/[id]", "PATCH", { name: `${f.tag} HR đổi` }, P(id)))).toBe(403);
    expect(await st(f.as("HR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E2 }, P(id)))).toBe(403);
    expect(await st(f.as("HR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E2, role: "MEMBER" }] }, P(id)))).toBe(403);
    expect(await st(f.as("HR", "tasks/projects/[id]", "DELETE", undefined, P(id)))).toBe(403);
  });
});

describe("chủ dự án / chuyển quyền sở hữu", () => {
  it("chuyển cho: chính mình / người ngoài / thành viên đã nghỉ / id không tồn tại → 400", async () => {
    const id = await f.project("MGR", { E1: "MEMBER", E4: "MEMBER" });
    expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.MGR }, P(id)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E3 }, P(id)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: 99999999 }, P(id)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: -3 }, P(id)))).toBe(400);
    await prisma.employee.update({ where: { id: f.users.E4 }, data: { active: false } });
    try {
      expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E4 }, P(id)))).toBe(400);
    } finally {
      await prisma.employee.update({ where: { id: f.users.E4 }, data: { active: true } });
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(f.users.MGR);
  });

  it("chủ không tự rời, không tự hạ; chủ cũ sau khi chuyển mất quyền đổi tên / xóa", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    expect(await st(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.MGR)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.MGR, role: "ADMIN" }] }, P(id)))).toBe(403);
    await f.ok(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E1 }, P(id)));
    expect(await st(f.as("MGR", "tasks/projects/[id]", "PATCH", { name: `${f.tag} chủ cũ đổi` }, P(id)))).toBe(403);
    expect(await st(f.as("MGR", "tasks/projects/[id]", "DELETE", undefined, P(id)))).toBe(403);
    expect(await st(f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.MGR }, P(id)))).toBe(403);
    // Chủ mới (vốn là nhân viên thường) gỡ được chủ cũ, giờ là ADMIN.
    await f.ok(f.as("E1", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.MGR)));
    expect(await st(f.as("MGR", "tasks/projects/[id]", "GET", undefined, P(id)))).toBe(404);
  });

  it("hai lượt chuyển chủ cùng lúc: đúng một lượt thành công, đúng một dòng OWNER khớp ownerId", async () => {
    const id = await f.project("MGR", { E1: "MEMBER", E2: "MEMBER" });
    const [a, b] = await Promise.all([
      f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E1 }, P(id)),
      f.as("MGR", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E2 }, P(id)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, include: { members: true } });
    const owners = p.members.filter((m) => m.role === "OWNER");
    expect(owners).toHaveLength(1);
    expect(owners[0].employeeId).toBe(p.ownerId);
    expect(p.members.find((m) => m.employeeId === f.users.MGR)?.role).toBe("ADMIN");
  });

  it("chủ đã nghỉ việc: Quản trị hệ thống (không là thành viên) chuyển quyền được", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    await prisma.employee.update({ where: { id: f.users.MGR }, data: { active: false } });
    try {
      await f.ok(f.as("ADMIN", "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E1 }, P(id)));
    } finally {
      await prisma.employee.update({ where: { id: f.users.MGR }, data: { active: true } });
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(f.users.E1);
  });
});

describe("dự án đã xóa mềm — mọi route", () => {
  it("chủ / ADMIN / Cộng tác: mọi route việc → 404; route dự án (trừ GET của chủ, khôi phục) → 404; job bỏ qua", async () => {
    const id = await f.project("MGR", { E2: "ADMIN", E3: "CONTRIBUTOR" });
    const t = await f.task("MGR", id, { assigneeIds: [f.users.E3], reminder: "ON_DUE", dueAt: at("2033-08-01", "10:00") });
    await f.ok(f.as("MGR", "tasks/projects/[id]", "DELETE", undefined, P(id)));
    for (const who of ["MGR", "E2", "E3", "HR", "ADMIN"] as const) await expectAllTaskRoutes(who, t.id, 404);
    for (const who of ["MGR", "E2", "HR"] as const) {
      expect(await st(f.as(who, "tasks/projects/[id]", "PATCH", { description: "x" }, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]", "DELETE", undefined, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E1, role: "MEMBER" }] }, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.E3))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]/transfer-owner", "POST", { employeeId: f.users.E2 }, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]/tasks", "GET", undefined, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/projects/[id]/tasks", "POST", { title: "x", dueAt: "2030-01-10T10:00:00.000Z" }, P(id))), who).toBe(404);
      expect(await st(f.as(who, "tasks/members-pool", "GET", { projectId: String(id) })), who).toBe(404);
    }
    expect(await st(f.as("E2", "tasks/projects/[id]", "GET", undefined, P(id)))).toBe(404);
    expect(await st(f.as("E2", "tasks/zalo-groups", "GET", { projectId: String(id) }))).toBe(404);
    expect(await st(f.as("E2", "tasks/projects/[id]/restore", "POST", undefined, P(id)))).toBe(404);
    expect(await st(f.as("MGR", "tasks/projects/[id]", "GET", undefined, P(id)))).toBe(200);
    const my = await f.ok<{ tasks: { id: number }[] }>(f.as("E3", "tasks/my", "GET", { done: "1" }));
    expect(my.tasks.map((x) => x.id)).not.toContain(t.id);
    await runJob("task-reminders", vnDateTime("2033-08-01", "10:05"));
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_DUE_SOON" } })).toBe(0);
    // Thùng rác: E2 (không phải chủ) không thấy; chủ thấy.
    const trash = async (who: Who) => (await f.ok<{ projects: { id: number }[] }>(f.as(who, "tasks/projects", "GET", { deleted: "1" }))).projects.map((p) => p.id);
    expect(await trash("E2")).not.toContain(id);
    expect(await trash("MGR")).toContain(id);
    // Khôi phục hai lần: lần hai 400 (không 500).
    await f.ok(f.as("MGR", "tasks/projects/[id]/restore", "POST", undefined, P(id)));
    expect(await st(f.as("MGR", "tasks/projects/[id]/restore", "POST", undefined, P(id)))).toBe(400);
  });
});

describe("người đã bị gỡ khỏi dự án", () => {
  it("mọi route → 404, không còn trong Việc của tôi / danh sách dự án", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    const t = await f.task("E1", id, { assigneeIds: [f.users.E1] });
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.E1)));
    await expectAllTaskRoutes("E1", t.id, 404);
    expect(await st(f.as("E1", "tasks/projects/[id]", "GET", undefined, P(id)))).toBe(404);
    expect(await st(f.as("E1", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.E1)))).toBe(404);
    const my = await f.ok<{ tasks: { id: number }[] }>(f.as("E1", "tasks/my", "GET", { done: "1" }));
    expect(my.tasks.map((x) => x.id)).not.toContain(t.id);
    const list = await f.ok<{ projects: { id: number }[] }>(f.as("E1", "tasks/projects"));
    expect(list.projects.map((p) => p.id)).not.toContain(id);
  });

  it("không còn nhận chuông đổi trạng thái / bình luận của việc mình từng tạo (đã không mở được việc đó)", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    const t = await f.task("E1", id, { title: `${f.tag} việc của người cũ` });
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.E1)));
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DOING" }, P(t.id)));
    await f.ok(f.as("MGR", "tasks/[id]/comments", "POST", { text: "nội bộ" }, P(t.id)), 201);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.E1 } })).toBe(0);
  });

  it("không còn nhận nhắc hạn (chuông + Zalo riêng) / báo quá hạn của việc mình từng tạo", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" });
    const t = await f.task("E1", id, { title: `${f.tag} nhắc người cũ`, reminder: "ON_DUE", dueAt: at("2033-02-01", "10:00") });
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, f.users.E1)));
    await runJob("task-reminders", vnDateTime("2033-02-01", "10:05"));
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.E1 } })).toBe(0);
    expect(await prisma.notificationLog.count({ where: { toEmployeeId: f.users.E1, dedupeKey: { startsWith: `task-remind:${t.id}:` } } })).toBe(0);
  });
});

describe("dữ liệu vào xấu", () => {
  it("chuỗi quá dài / trống / ngày không có thật / id rác → 400, không 500", async () => {
    const post = (body: Record<string, unknown>) => st(f.as("MGR", "tasks/projects/[id]/tasks", "POST", { title: "x", dueAt: "2030-01-10T10:00:00.000Z", ...body }, P(pid)));
    expect(await post({ title: "x".repeat(201) })).toBe(400);
    expect(await post({ title: "  " })).toBe(400);
    expect(await post({ description: "x".repeat(5001) })).toBe(400);
    expect(await post({ dueAt: "2030-02-30T10:00:00Z" })).toBe(400);
    expect(await post({ dueAt: "mai" })).toBe(400);
    expect(await post({ dueAt: null })).toBe(400);
    expect(await post({ recurrenceTime: "24:00", recurrence: "DAILY" })).toBe(400);
    expect(await post({ status: "ARCHIVED" })).toBe(400);
    expect(await post({ priority: "CRITICAL" })).toBe(400);
    expect(await post({ subtasks: Array(51).fill("a") })).toBe(400);
    expect(await post({ assigneeIds: Array.from({ length: 21 }, (_, i) => i + 1) })).toBe(400);
    expect(await post({ assigneeIds: [f.users.E4] })).toBe(400); // không là thành viên
    expect(await post({ status: "DONE", subtasks: ["chưa xong"] })).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]", "GET", undefined, { id: "abc" }))).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]", "GET", undefined, { id: "0" }))).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]", "GET", undefined, { id: "99999999" }))).toBe(404);
    expect(await st(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, { id: String(pid), employeeId: "x" }))).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]/comments", "POST", { text: "x".repeat(2001) }, P(tOwner.id)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]/comments", "POST", { text: " " }, P(tOwner.id)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/tasks", "GET", { q: "x".repeat(101) }, P(pid)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/notifications", "GET", { take: "0" }))).toBe(400);
    expect(await st(f.as("MGR", "tasks/notifications", "GET", { take: "101" }))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: Array.from({ length: 51 }, (_, i) => ({ employeeId: i + 1, role: "MEMBER" })) }, P(pid)))).toBe(400);
    expect(await st(f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: f.users.E4, role: "MEMBER" }, { employeeId: f.users.E4, role: "ADMIN" }] }, P(pid)))).toBe(400);
  });

  it("thân JSON hỏng → 400", async () => {
    const r = await taskRoute.PATCH(
      new NextRequest(new URL(`/api/tasks/${tOwner.id}`, BASE), { method: "PATCH", headers: { cookie: f.cookies.MGR, "content-type": "application/json" }, body: "{hỏng" }),
      rctx(P(tOwner.id)),
    );
    expect(r.status).toBe(400);
  });

  it("ngày bắt đầu không có thật (30/02) → 400", async () => {
    const r = await f.as("MGR", "tasks/projects/[id]/tasks", "POST", { title: `${f.tag} 30/02`, dueAt: at("2031-03-05", "10:00"), startDate: "2031-02-30" }, P(pid));
    const body = (await r.json()) as { task?: { id: number } };
    if (body.task) await prisma.task.delete({ where: { id: body.task.id } });
    expect(r.status).toBe(400);
    expect(await st(f.as("MGR", "tasks/[id]", "PATCH", { startDate: "2029-13-45" }, P(tOwner.id)))).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: tOwner.id } })).startDate).not.toBe("2029-13-45");
  });

  it("ngày bắt đầu so theo giờ VN: hạn 23:30 ngày 10 (VN) ⇒ bắt đầu ngày 11 bị chặn, ngày 10 được", async () => {
    const dueAt = at("2030-01-10", "23:30"); // = 16:30 UTC
    expect(await st(f.as("MGR", "tasks/projects/[id]/tasks", "POST", { title: "x", dueAt, startDate: "2030-01-11" }, P(pid)))).toBe(400);
    const t = await f.task("MGR", pid, { dueAt, startDate: "2030-01-10" });
    // Dời hạn lên trước ngày bắt đầu đang có → 400, dữ liệu không đổi.
    expect(await st(f.as("MGR", "tasks/[id]", "PATCH", { dueAt: at("2030-01-09", "10:00") }, P(t.id)))).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).dueAt.toISOString()).toBe(dueAt);
  });

  it("PATCH kèm trường hệ thống (completedAt / projectId / parentId / createdById / occurrenceDate) → 400, không đổi gì", async () => {
    const other = await f.project("MGR");
    for (const body of [
      { completedAt: "2030-01-01T00:00:00.000Z" },
      { projectId: other },
      { parentId: tE1.id },
      { createdById: f.users.E3 },
      { occurrenceDate: "2030-01-01" },
      { title: "hợp lệ", status: "DONE" },
    ]) {
      expect(await st(f.as("MGR", "tasks/[id]", "PATCH", body, P(tOwner.id))), JSON.stringify(body)).toBe(400);
    }
    const t = await prisma.task.findUniqueOrThrow({ where: { id: tOwner.id } });
    expect([t.projectId, t.parentId, t.createdById, t.completedAt, t.status]).toEqual([pid, null, f.users.MGR, null, "TODO"]);
  });

  it("POST kèm trường hệ thống: bị bỏ qua (người tạo = người gọi, đúng dự án trên URL)", async () => {
    const other = await f.project("MGR");
    const { task } = await f.ok<{ task: { id: number } }>(
      f.as("E3", "tasks/projects/[id]/tasks", "POST", { title: `${f.tag} giả mạo`, dueAt: "2030-01-10T10:00:00.000Z", createdById: f.users.MGR, projectId: other, parentId: tOwner.id, occurrenceDate: "2030-01-01", completedAt: "2030-01-01T00:00:00.000Z" }, P(pid)),
      201,
    );
    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect([t.createdById, t.projectId, t.parentId, t.occurrenceDate, t.completedAt]).toEqual([f.users.E3, pid, null, null, null]);
  });

  it("bản lặp không đặt lặp được; 50 việc con tạo được, 51 thì không", async () => {
    const root = await f.task("MGR", pid, { dueAt: at("2032-01-01", "17:00"), recurrence: "DAILY" });
    await runJob("task-recurrence", vnDateTime("2032-01-02", "00:10"));
    const copy = await prisma.task.findFirstOrThrow({ where: { parentId: root.id } });
    expect(await st(f.as("MGR", "tasks/[id]", "PATCH", { recurrence: "WEEKLY" }, P(copy.id)))).toBe(400);
    await prisma.task.update({ where: { id: root.id }, data: { recurrence: "NONE" } }); // thôi lặp để job khác không đụng
    await f.task("MGR", pid, { subtasks: Array(50).fill("ok") });
  });
});

describe("phụ thuộc — biên + đồng thời", () => {
  it("21 việc / tự trỏ (kèm trùng) / khác dự án / id không tồn tại → 400", async () => {
    const a = await f.task("MGR", pid, { title: "A" });
    const other = await f.task("MGR", await f.project("MGR"));
    const deps = (dependsOn: unknown[]) => st(f.as("MGR", "tasks/[id]/dependencies", "PUT", { dependsOn }, P(a.id)));
    expect(await deps(Array.from({ length: 21 }, (_, i) => i + 1))).toBe(400);
    expect(await deps([a.id, a.id])).toBe(400);
    expect(await deps([tOwner.id, other.id])).toBe(400);
    expect(await deps([99999999])).toBe(400);
    expect(await prisma.taskDependency.count({ where: { taskId: a.id } })).toBe(0);
    // Trùng trong danh sách được gộp, không 500.
    await f.ok(f.as("MGR", "tasks/[id]/dependencies", "PUT", { dependsOn: [tOwner.id, tOwner.id] }, P(a.id)));
    expect(await prisma.taskDependency.count({ where: { taskId: a.id } })).toBe(1);
  });

  it("A→B và B→A gửi cùng lúc: đúng một lượt thành công, DB không có vòng", async () => {
    const a = await f.task("MGR", pid, { title: "A2" });
    const b = await f.task("MGR", pid, { title: "B2" });
    const [r1, r2] = await Promise.all([
      f.as("MGR", "tasks/[id]/dependencies", "PUT", { dependsOn: [b.id] }, P(a.id)),
      f.as("E2", "tasks/[id]/dependencies", "PUT", { dependsOn: [a.id] }, P(b.id)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect(await prisma.taskDependency.count({ where: { OR: [{ taskId: a.id }, { taskId: b.id }] } })).toBe(1);
  });

  it("xóa việc bị phụ thuộc: cạnh phụ thuộc biến mất theo", async () => {
    const a = await f.task("MGR", pid);
    const b = await f.task("MGR", pid);
    await f.ok(f.as("MGR", "tasks/[id]/dependencies", "PUT", { dependsOn: [a.id] }, P(b.id)));
    await f.ok(f.as("MGR", "tasks/[id]", "DELETE", undefined, P(a.id)));
    const { task } = await f.ok<{ task: { dependsOn: number[] } }>(f.as("MGR", "tasks/[id]", "GET", undefined, P(b.id)));
    expect(task.dependsOn).toEqual([]);
  });
});

describe("trạng thái — đồng thời", () => {
  it("5 người kéo cùng lúc từ TODO: đúng 1 lượt 200, còn lại 409; completedAt khớp trạng thái", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1, f.users.E3] });
    const who: Who[] = ["MGR", "E2", "E1", "E3", "HR"];
    const targets = ["DONE", "DOING", "REVIEW", "DONE", "DOING"];
    const rs = await Promise.all(who.map((w, i) => f.as(w, "tasks/[id]/status", "POST", { status: targets[i], fromStatus: "TODO" }, P(t.id))));
    const codes = rs.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409]);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.completedAt === null).toBe(row.status !== "DONE");
    expect(await prisma.auditLog.count({ where: { action: "TASK_STATUS", entityId: String(t.id) } })).toBe(1);
  });

  it("đổi trạng thái vô hiệu (không fromStatus) chạy tuần tự, không mất lượt", async () => {
    const t = await f.task("MGR", pid);
    const rs = await Promise.all(["DOING", "REVIEW", "DONE"].map((s) => f.as("MGR", "tasks/[id]/status", "POST", { status: s }, P(t.id))));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await prisma.auditLog.count({ where: { action: "TASK_STATUS", entityId: String(t.id) } })).toBe(3);
  });
});

describe("job — idempotent với giờ cố định", () => {
  it("task-recurrence chạy song song 3 lần: đúng 1 bản lặp, 1 chuông", async () => {
    const root = await f.task("MGR", pid, { title: `${f.tag} lặp song song`, dueAt: at("2032-05-01", "17:00"), recurrence: "DAILY", assigneeIds: [f.users.E1] });
    const now = vnDateTime("2032-05-02", "00:10");
    await Promise.all([runJob("task-recurrence", now), runJob("task-recurrence", now), runJob("task-recurrence", now)]);
    const copies = await prisma.task.findMany({ where: { parentId: root.id } });
    expect(copies).toHaveLength(1);
    expect(await prisma.inAppNotification.count({ where: { taskId: copies[0].id, employeeId: f.users.E1 } })).toBe(1);
    await prisma.task.update({ where: { id: root.id }, data: { recurrence: "NONE" } });
  });

  it("task-recurrence: xóa bản lặp hôm nay rồi chạy lại ⇒ không sinh lại; người đã nghỉ việc không bị chép sang bản mới", async () => {
    const root = await f.task("MGR", pid, { title: `${f.tag} lặp xóa`, dueAt: at("2032-06-01", "17:00"), recurrence: "DAILY", assigneeIds: [f.users.E1, f.users.E3] });
    try {
      await runJob("task-recurrence", vnDateTime("2032-06-02", "00:10"));
      const c1 = await prisma.task.findFirstOrThrow({ where: { parentId: root.id, occurrenceDate: "2032-06-02" } });
      await f.ok(f.as("MGR", "tasks/[id]", "DELETE", undefined, P(c1.id)));
      await runJob("task-recurrence", vnDateTime("2032-06-02", "08:00"));
      expect(await prisma.task.count({ where: { parentId: root.id, occurrenceDate: "2032-06-02" } })).toBe(0);
      await prisma.employee.update({ where: { id: f.users.E3 }, data: { active: false } });
      await runJob("task-recurrence", vnDateTime("2032-06-03", "00:10"));
      const c2 = await prisma.task.findFirstOrThrow({ where: { parentId: root.id, occurrenceDate: "2032-06-03" }, include: { assignees: true } });
      expect(c2.assignees.map((a) => a.employeeId)).toEqual([f.users.E1]);
      expect(await prisma.inAppNotification.count({ where: { taskId: c2.id, employeeId: f.users.E3 } })).toBe(0);
    } finally {
      await prisma.employee.update({ where: { id: f.users.E3 }, data: { active: true } });
      await prisma.task.update({ where: { id: root.id }, data: { recurrence: "NONE" } });
    }
  });

  it("task-recurrence: một việc gốc có ngày bắt đầu hỏng không làm cả job sập (việc gốc khác vẫn sinh bản)", async () => {
    // Ghi thẳng DB vì API hiện CHẤP NHẬN "2032-02-30" (xem test "ngày bắt đầu không có thật").
    const bad = await f.task("MGR", pid, { title: `${f.tag} gốc hỏng`, dueAt: at("2032-03-05", "17:00"), recurrence: "DAILY" });
    const good = await f.task("MGR", pid, { title: `${f.tag} gốc tốt`, dueAt: at("2032-03-05", "17:00"), recurrence: "DAILY" });
    await prisma.task.update({ where: { id: bad.id }, data: { startDate: "2032-02-30" } });
    try {
      await expect(runJob("task-recurrence", vnDateTime("2032-03-06", "00:10"))).resolves.toBeDefined();
      expect(await prisma.task.count({ where: { parentId: good.id } })).toBe(1);
    } finally {
      await prisma.task.updateMany({ where: { id: { in: [bad.id, good.id] } }, data: { recurrence: "NONE" } });
    }
  });

  it("nhắc hạn: 2 người được giao ⇒ mỗi người 1 chuông + 1 tin riêng; đổi kiểu nhắc ⇒ nhắc lại 1 lần; việc xong ⇒ không nhắc", async () => {
    const t = await f.task("MGR", pid, { title: `${f.tag} nhắc 2 người`, dueAt: at("2033-03-10", "17:00"), reminder: "D2", assigneeIds: [f.users.E1, f.users.E3] });
    const bells = () => prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_DUE_SOON" } });
    const zalo = () => prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `task-remind:${t.id}:` } } });
    await runJob("task-reminders", vnDateTime("2033-03-08", "17:05"));
    await runJob("task-reminders", vnDateTime("2033-03-08", "17:05"));
    expect([await bells(), await zalo()]).toEqual([2, 2]);
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { reminder: "D1" }, P(t.id)));
    await runJob("task-reminders", vnDateTime("2033-03-09", "17:05"));
    await runJob("task-reminders", vnDateTime("2033-03-09", "18:05"));
    expect([await bells(), await zalo()]).toEqual([4, 4]);
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { reminder: "ON_DUE" }, P(t.id)));
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DONE" }, P(t.id)));
    await runJob("task-reminders", vnDateTime("2033-03-10", "17:05"));
    expect(await bells()).toBe(4);
  });

  it("nhắc hạn: dời hạn nhiều lần ⇒ mỗi mốc nhắc đúng 1 lần; chạy lại sau khi dời không nhắc mốc cũ", async () => {
    const t = await f.task("MGR", pid, { title: `${f.tag} dời hạn`, dueAt: at("2033-04-10", "10:00"), reminder: "ON_DUE", assigneeIds: [f.users.E1] });
    const bells = () => prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_DUE_SOON", employeeId: f.users.E1 } });
    await runJob("task-reminders", vnDateTime("2033-04-10", "10:05"));
    expect(await bells()).toBe(1);
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { dueAt: at("2033-04-10", "11:00") }, P(t.id)));
    await runJob("task-reminders", vnDateTime("2033-04-10", "10:30")); // mốc mới chưa tới
    expect(await bells()).toBe(1);
    await runJob("task-reminders", vnDateTime("2033-04-10", "11:05"));
    await runJob("task-reminders", vnDateTime("2033-04-10", "12:05"));
    expect(await bells()).toBe(2);
  });

  it("báo quá hạn: >15 việc ⇒ 15 dòng + '… và N việc nữa'; chạy lại cùng ngày không gửi thêm", async () => {
    const id = await f.project("MGR", { E1: "MEMBER" }, { zaloGroupId: f.groupId });
    for (let i = 1; i <= 17; i++) await f.task("MGR", id, { title: `${f.tag} trễ số ${String(i).padStart(2, "0")}`, dueAt: at("2033-07-01", "10:00"), assigneeIds: [f.users.E1] });
    await runJob("task-overdue-digest", vnDateTime("2033-07-05", "09:00"));
    await runJob("task-overdue-digest", vnDateTime("2033-07-05", "09:00"));
    const logs = await prisma.notificationLog.findMany({ where: { dedupeKey: `task-overdue:${id}:2033-07-05@${f.groupId}` } });
    expect(logs).toHaveLength(1);
    const text = JSON.parse(logs[0].payload).text as string;
    expect(text).toContain("trễ số 15");
    expect(text).not.toContain("trễ số 16");
    expect(text).toContain("và 2 việc nữa");
    expect(await prisma.inAppNotification.count({ where: { employeeId: f.users.E1, dedupeKey: `task-overdue:2033-07-05:${f.users.E1}` } })).toBe(1);
  });
});

describe("Zalo: không lộ mô tả / bình luận / dữ liệu cá nhân", () => {
  it("mọi tin của dự án (việc mới, trạng thái, bình luận, nhắc tên, nhắc hạn, sắp hạn, quá hạn) không chứa mô tả / nội dung bình luận / SĐT", async () => {
    const secret = `MOTA${f.tag}BIMAT`;
    const csecret = `BINHLUAN${f.tag}BIMAT`;
    const id = await f.project("MGR", { E1: "MEMBER", E2: "MEMBER" }, { zaloGroupId: f.groupId });
    const t = await f.task("MGR", id, { title: `${f.tag} kiểm rò rỉ`, description: secret, dueAt: at("2033-09-10", "10:30"), reminder: "ON_DUE", assigneeIds: [f.users.E1] });
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DOING" }, P(t.id)));
    await f.ok(f.as("E1", "tasks/[id]/comments", "POST", { text: `${csecret} @${f.codes.E2}` }, P(t.id)), 201);
    await runJob("task-reminders", vnDateTime("2033-09-10", "10:05")); // sắp hạn trong 1 giờ (nhóm)
    await runJob("task-reminders", vnDateTime("2033-09-10", "10:35")); // đúng hạn (riêng)
    await runJob("task-overdue-digest", vnDateTime("2033-09-12", "09:00"));
    const logs = await prisma.notificationLog.findMany({ where: { payload: { contains: `kiểm rò rỉ` } } });
    const types = new Set(logs.map((l) => l.messageType));
    for (const m of ["TASK_NEW", "TASK_STATUS", "TASK_COMMENT", "TASK_MENTION", "TASK_DUE_SOON", "TASK_DUE_PERSONAL", "TASK_OVERDUE_DIGEST"]) expect(types, m).toContain(m);
    const phones = (await prisma.employee.findMany({ where: { id: { in: Object.values(f.users) } }, select: { phone: true } })).map((e) => e.phone).filter(Boolean) as string[];
    for (const l of logs) {
      expect(l.payload, l.messageType).not.toContain(secret);
      expect(l.payload, l.messageType).not.toContain(csecret);
      for (const p of phones) expect(l.payload, l.messageType).not.toContain(p);
    }
    // Chuông trong app cũng không chép nội dung bình luận / mô tả.
    const bells = await prisma.inAppNotification.findMany({ where: { taskId: t.id } });
    expect(bells.length).toBeGreaterThan(0);
    for (const b of bells) expect(`${b.title} ${b.body ?? ""}`).not.toMatch(new RegExp(`${secret}|${csecret}`));
  });

  it("nhóm Zalo đã xóa khỏi Cấu hình: dự án thôi gửi, không gắn lại được, tạo dự án mới với nhóm đó → 400", async () => {
    const gid = `${f.tag}-gone`;
    await prisma.zaloGroup.create({ data: { groupId: gid, name: "tạm", source: "MANUAL" } });
    const id = await f.project("MGR", { E2: "ADMIN" }, { zaloGroupId: gid });
    await f.ok(f.as("ADMIN", "settings/zalo/groups/[groupId]", "DELETE", undefined, { groupId: gid }));
    const t = await f.task("MGR", id);
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DOING" }, P(t.id)));
    expect(await prisma.notificationLog.count({ where: { toGroupId: gid, messageType: { startsWith: "TASK_" } } })).toBe(0);
    expect(await st(f.as("MGR", "tasks/projects/[id]", "PATCH", { zaloGroupId: gid }, P(id)))).toBe(400);
    // Quản lý dự án là nhân viên thường (không có tasks.createProject) không tự trỏ dự án vào nhóm Zalo nào được.
    expect(await st(f.as("E2", "tasks/projects/[id]", "PATCH", { zaloGroupId: f.groupId }, P(id)))).toBe(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).zaloGroupId).toBeNull();
    expect(await st(f.as("MGR", "tasks/projects", "POST", { name: `${f.tag} nhóm cũ`, zaloGroupId: gid }))).toBe(400);
    const groups = await f.ok<{ groups: { groupId: string }[] }>(f.as("MGR", "tasks/zalo-groups", "GET", { projectId: String(id) }));
    expect(groups.groups.map((g) => g.groupId)).not.toContain(gid);
    await prisma.notificationLog.deleteMany({ where: { toGroupId: gid } });
  });
});

describe("chuông — cách ly theo người", () => {
  it("không thấy / không đánh dấu được chuông của người khác; đánh dấu lại không đếm trùng", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1, f.users.E3] });
    const e1 = await prisma.inAppNotification.findFirstOrThrow({ where: { taskId: t.id, employeeId: f.users.E1 } });
    const e3 = await prisma.inAppNotification.findFirstOrThrow({ where: { taskId: t.id, employeeId: f.users.E3 } });
    const list = await f.ok<{ notifications: { id: number }[] }>(f.as("E3", "tasks/notifications", "GET", { take: "100" }));
    expect(list.notifications.map((n) => n.id)).not.toContain(e1.id);
    const r = await f.ok<{ updated: number }>(f.as("E3", "tasks/notifications/read", "POST", { ids: [e1.id, e3.id] }));
    expect(r.updated).toBe(1);
    expect((await f.ok<{ updated: number }>(f.as("E3", "tasks/notifications/read", "POST", { ids: [e3.id] }))).updated).toBe(0);
    expect((await prisma.inAppNotification.findUniqueOrThrow({ where: { id: e1.id } })).readAt).toBeNull();
    expect(await st(f.as("E3", "tasks/notifications/read", "POST", { ids: Array.from({ length: 201 }, (_, i) => i + 1) }))).toBe(400);
  });
});

describe("xóa cứng nhân viên", () => {
  it("người chỉ còn dấu vết là bình luận (đã bị gỡ khỏi dự án) vẫn không xóa cứng được", async () => {
    const tmpl = await prisma.employee.findUniqueOrThrow({ where: { id: f.users.E1 } });
    const x = await prisma.employee.create({
      data: {
        code: `${f.tag}X`,
        name: `${f.tag} X`,
        phone: `09${randomInt(100000000).toString().padStart(8, "0")}`,
        passwordHash: await bcrypt.hash("Fixture123", 4),
        role: "EMPLOYEE",
        departmentId: tmpl.departmentId,
        defaultShiftId: tmpl.defaultShiftId,
        mustChangePassword: false,
      },
    });
    extraEmployees.push(x.id);
    const id = await f.project("MGR");
    await f.ok(f.as("MGR", "tasks/projects/[id]/members", "PUT", { members: [{ employeeId: x.id, role: "MEMBER" }] }, P(id)));
    const t = await f.task("MGR", id);
    const cookie = await sessionCookie(x.id);
    await f.ok(f.call("tasks/[id]/comments", "POST", cookie, { text: "dấu vết" }, P(t.id)), 201);
    await f.ok(f.as("MGR", "tasks/projects/[id]/members/[employeeId]", "DELETE", undefined, PM(id, x.id)));
    const r = await f.as("ADMIN", "employees/[id]", "DELETE", undefined, P(x.id));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("công việc");
    expect(await prisma.employee.count({ where: { id: x.id } })).toBe(1);
  });
});
