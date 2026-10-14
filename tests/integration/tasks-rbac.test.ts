/** v1.23.0 — quyền theo vai trò dự án, kiểm Ở SERVER (client chỉ ẩn nút). */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TR");
const P = (id: number) => ({ id: String(id) });
let pid = 0;
let byOwner: { id: number }, forE3: { id: number }, byE3: { id: number }, byE1: { id: number };

beforeAll(async () => {
  // MGR = Chủ dự án, E1 = Thành viên, E2 = Quản lý dự án, E3 = Cộng tác, E4 = người ngoài.
  pid = await f.project("MGR", { E1: "MEMBER", E2: "ADMIN", E3: "CONTRIBUTOR" });
  byOwner = await f.task("MGR", pid, { title: `${f.tag} của chủ` });
  forE3 = await f.task("MGR", pid, { title: `${f.tag} giao E3`, assigneeIds: [f.users.E3] });
  byE3 = await f.task("E3", pid, { title: `${f.tag} E3 tự tạo` });
  byE1 = await f.task("E1", pid, { title: `${f.tag} E1 tự tạo` });
});

const list = async (who: "E1" | "E3" | "HR") => (await f.ok<{ tasks: { id: number }[] }>(f.as(who, "tasks/projects/[id]/tasks", "GET", undefined, P(pid)))).tasks.map((t) => t.id).sort();

describe("Cộng tác", () => {
  it("danh sách chỉ có việc được giao / tự tạo; việc khác GET → 404", async () => {
    expect(await list("E3")).toEqual([forE3.id, byE3.id].sort());
    expect((await f.as("E3", "tasks/[id]", "GET", undefined, P(byOwner.id))).status).toBe(404);
    expect((await f.as("E3", "tasks/[id]/comments", "GET", undefined, P(byOwner.id))).status).toBe(404);
    expect((await f.as("E3", "tasks/[id]/status", "POST", { status: "DOING" }, P(byOwner.id))).status).toBe(404);
  });
  it("sửa / đổi trạng thái việc được giao; không giao việc cho người khác; không xóa", async () => {
    await f.ok(f.as("E3", "tasks/[id]", "PATCH", { priority: "HIGH" }, P(forE3.id)));
    await f.ok(f.as("E3", "tasks/[id]/status", "POST", { status: "DOING" }, P(forE3.id)));
    expect((await f.as("E3", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E3, f.users.E1] }, P(byE3.id))).status).toBe(403);
    expect((await f.as("E3", "tasks/projects/[id]/tasks", "POST", { title: "x", dueAt: "2030-01-10T10:00:00.000Z", assigneeIds: [f.users.E1] }, P(pid))).status).toBe(403);
    await f.ok(f.as("E3", "tasks/projects/[id]/tasks", "POST", { title: `${f.tag} tự nhận`, dueAt: "2030-01-10T10:00:00.000Z", assigneeIds: [f.users.E3] }, P(pid)), 201);
    expect((await f.as("E3", "tasks/[id]", "DELETE", undefined, P(byE3.id))).status).toBe(403);
  });
});

describe("Thành viên", () => {
  it("thấy mọi việc, sửa việc mình tạo / được giao, KHÔNG sửa việc người khác, KHÔNG xóa", async () => {
    expect((await list("E1")).length).toBeGreaterThanOrEqual(4);
    await f.ok(f.as("E1", "tasks/[id]", "PATCH", { title: `${f.tag} E1 sửa` }, P(byE1.id)));
    expect((await f.as("E1", "tasks/[id]", "PATCH", { title: "không được" }, P(byOwner.id))).status).toBe(403);
    expect((await f.as("E1", "tasks/[id]/status", "POST", { status: "DONE" }, P(byOwner.id))).status).toBe(403);
    expect((await f.as("E1", "tasks/[id]", "DELETE", undefined, P(byE1.id))).status).toBe(403);
    // Bình luận được mọi việc mình thấy.
    await f.ok(f.as("E1", "tasks/[id]/comments", "POST", { text: "ý kiến" }, P(byOwner.id)), 201);
  });
  it("giao việc mình tạo cho thành viên khác được", async () => {
    await f.ok(f.as("E1", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E2] }, P(byE1.id)));
  });
});

describe("Quản lý dự án / Quản lý tất cả", () => {
  it("Quản lý dự án sửa + xóa mọi việc", async () => {
    const t = await f.task("MGR", pid, { title: `${f.tag} sẽ xóa` });
    await f.ok(f.as("E2", "tasks/[id]", "PATCH", { title: `${f.tag} E2 sửa` }, P(byOwner.id)));
    await f.ok(f.as("E2", "tasks/[id]", "DELETE", undefined, P(t.id)));
    expect(await prisma.task.count({ where: { id: t.id } })).toBe(0);
  });
  it("HR (tasks.manageAll) không là thành viên vẫn xem + sửa được", async () => {
    expect((await list("HR")).length).toBeGreaterThanOrEqual(4);
    await f.ok(f.as("HR", "tasks/[id]", "PATCH", { priority: "LOW" }, P(byOwner.id)));
  });
  it("người ngoài dự án: mọi việc → 404", async () => {
    expect((await f.as("E4", "tasks/[id]", "GET", undefined, P(byOwner.id))).status).toBe(404);
    expect((await f.as("E4", "tasks/[id]", "PATCH", { title: "x" }, P(byOwner.id))).status).toBe(404);
  });
});

describe("PATCH", () => {
  it("không nhận `status` (đổi trạng thái chỉ qua /status)", async () => {
    expect((await f.as("MGR", "tasks/[id]", "PATCH", { status: "DONE" }, P(byOwner.id))).status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: byOwner.id } })).status).not.toBe("DONE");
  });
  it("PATCH một trường không xóa trường khác (zod 4 .partial() không được có .default())", async () => {
    const t = await f.task("MGR", pid, {
      title: `${f.tag} đủ trường`,
      description: "mô tả gốc",
      priority: "URGENT",
      reminder: "D1",
      recurrence: "WEEKLY",
      recurrenceTime: "09:00",
      startDate: "2030-01-05",
      assigneeIds: [f.users.E1],
    });
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { title: `${f.tag} chỉ đổi tên` }, P(t.id)));
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, include: { assignees: true } });
    expect(after).toMatchObject({ description: "mô tả gốc", priority: "URGENT", reminder: "D1", recurrence: "WEEKLY", recurrenceTime: "09:00", startDate: "2030-01-05", status: "TODO" });
    expect(after.assignees.map((a) => a.employeeId)).toEqual([f.users.E1]);
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { recurrence: "NONE" }, P(t.id)));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).recurrenceTime).toBeNull();
  });
  it("ngày bắt đầu sau hạn → 400", async () => {
    expect((await f.as("MGR", "tasks/[id]", "PATCH", { startDate: "2031-01-01" }, P(byOwner.id))).status).toBe(400);
  });
});
