/** v1.23.0 — job nền Công việc: giờ CỐ ĐỊNH (không dùng new Date() cho dữ liệu nghiệp vụ), chạy lại không trùng. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { vnDateTime } from "@/lib/attendance";
import { runJob } from "@/lib/jobs";
import { setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TJ");
let pid = 0;

beforeAll(async () => {
  pid = await f.project("MGR", { E1: "MEMBER" }, { zaloGroupId: f.groupId });
});

const at = (d: string, t: string) => vnDateTime(d, t);

describe("task-recurrence", () => {
  it("hằng ngày: sinh bản của hôm nay một lần, chép người giao + việc con (chưa xong), hạn theo giờ lặp", async () => {
    const root = await f.task("MGR", pid, {
      title: `${f.tag} giao ban`,
      dueAt: at("2031-03-02", "17:00").toISOString(),
      recurrence: "DAILY",
      recurrenceTime: "10:00",
      assigneeIds: [f.users.E1],
      subtasks: ["điểm danh"],
    });
    await runJob("task-recurrence", at("2031-03-03", "00:05"));
    await runJob("task-recurrence", at("2031-03-03", "08:00")); // chạy lại cùng ngày
    const copies = await prisma.task.findMany({ where: { parentId: root.id }, include: { assignees: true, subtasks: true } });
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ occurrenceDate: "2031-03-03", status: "TODO", recurrence: "NONE", title: `${f.tag} giao ban` });
    expect(copies[0].dueAt.toISOString()).toBe(at("2031-03-03", "10:00").toISOString());
    expect(copies[0].assignees.map((a) => a.employeeId)).toEqual([f.users.E1]);
    expect(copies[0].subtasks.map((s) => [s.text, s.done])).toEqual([["điểm danh", false]]);
    expect(await prisma.inAppNotification.count({ where: { taskId: copies[0].id, employeeId: f.users.E1 } })).toBe(1);
    // Server tắt 5 ngày: chỉ sinh bản của hôm nay.
    await runJob("task-recurrence", at("2031-03-09", "09:00"));
    expect((await prisma.task.findMany({ where: { parentId: root.id } })).map((t) => t.occurrenceDate).sort()).toEqual(["2031-03-03", "2031-03-09"]);
  });
  it("dự án đã xóa thì không sinh bản lặp", async () => {
    const p2 = await f.project("MGR");
    const root = await f.task("MGR", p2, { dueAt: at("2031-03-02", "17:00").toISOString(), recurrence: "DAILY" });
    await f.ok(f.as("MGR", "tasks/projects/[id]", "DELETE", undefined, { id: String(p2) }));
    await runJob("task-recurrence", at("2031-03-03", "08:00"));
    expect(await prisma.task.count({ where: { parentId: root.id } })).toBe(0);
  });
});

describe("task-reminders", () => {
  it("nhắc trước 1 ngày: một lần cho mỗi mốc; đổi hạn ⇒ nhắc lại; quá 24 giờ thì không nhắc dồn", async () => {
    const t = await f.task("MGR", pid, { title: `${f.tag} nộp hồ sơ`, dueAt: at("2031-04-10", "17:00").toISOString(), reminder: "D1", assigneeIds: [f.users.E1] });
    const count = () => prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_DUE_SOON", employeeId: f.users.E1 } });
    const zalo = () => prisma.notificationLog.count({ where: { messageType: "TASK_DUE_PERSONAL", toEmployeeId: f.users.E1 } });
    await runJob("task-reminders", at("2031-04-09", "16:05")); // chưa tới mốc (17:00 ngày 09)
    expect(await count()).toBe(0);
    await runJob("task-reminders", at("2031-04-09", "17:05"));
    await runJob("task-reminders", at("2031-04-09", "18:05"));
    expect(await count()).toBe(1);
    expect(await zalo()).toBe(1);
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { dueAt: at("2031-04-12", "17:00").toISOString() }, { id: String(t.id) }));
    await runJob("task-reminders", at("2031-04-11", "17:05"));
    expect(await count()).toBe(2);
    // Mốc đã qua hơn 24 giờ (server tắt): bỏ qua.
    const late = await f.task("MGR", pid, { dueAt: at("2031-04-20", "17:00").toISOString(), reminder: "W1", assigneeIds: [f.users.E1] });
    await runJob("task-reminders", at("2031-04-19", "08:05"));
    expect(await prisma.inAppNotification.count({ where: { taskId: late.id, kind: "TASK_DUE_SOON" } })).toBe(0);
  });
  it("tin nhóm: gom việc đến hạn trong 1 giờ tới thành MỘT tin mỗi dự án; chạy lại cùng giờ không gửi thêm", async () => {
    await f.task("MGR", pid, { title: `${f.tag} sắp hạn A`, dueAt: at("2031-05-05", "10:30").toISOString() });
    await f.task("MGR", pid, { title: `${f.tag} sắp hạn B`, dueAt: at("2031-05-05", "10:50").toISOString() });
    const n = () => prisma.notificationLog.count({ where: { toGroupId: f.groupId, messageType: "TASK_DUE_SOON" } });
    const before = await n();
    await runJob("task-reminders", at("2031-05-05", "10:05"));
    await runJob("task-reminders", at("2031-05-05", "10:06"));
    expect(await n()).toBe(before + 1);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { toGroupId: f.groupId, messageType: "TASK_DUE_SOON" }, orderBy: { id: "desc" } });
    expect(log.payload).toContain("sắp hạn A");
    expect(log.payload).toContain("sắp hạn B");
  });
});

describe("task-overdue-digest", () => {
  it("mỗi dự án một tin/ngày, chuông 1 dòng/người/ngày; việc xong không tính; hôm sau gửi lại", async () => {
    const p3 = await f.project("MGR", { E1: "MEMBER" }, { zaloGroupId: f.groupId });
    await f.task("MGR", p3, { title: `${f.tag} trễ 1`, dueAt: at("2031-06-01", "17:00").toISOString(), assigneeIds: [f.users.E1] });
    await f.task("MGR", p3, { title: `${f.tag} trễ 2`, dueAt: at("2031-06-02", "17:00").toISOString(), assigneeIds: [f.users.E1] });
    const done = await f.task("MGR", p3, { title: `${f.tag} đã xong`, dueAt: at("2031-06-01", "17:00").toISOString(), assigneeIds: [f.users.E1] });
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DONE" }, { id: String(done.id) }));
    await runJob("task-overdue-digest", at("2031-06-03", "09:00"));
    await runJob("task-overdue-digest", at("2031-06-03", "09:30"));
    const logs = await prisma.notificationLog.findMany({ where: { dedupeKey: `task-overdue:${p3}:2031-06-03@${f.groupId}` } });
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toContain("trễ 1");
    expect(logs[0].payload).not.toContain("đã xong");
    const bell = await prisma.inAppNotification.findMany({ where: { employeeId: f.users.E1, kind: "TASK_OVERDUE", dedupeKey: `task-overdue:2031-06-03:${f.users.E1}` } });
    expect(bell).toHaveLength(1);
    await runJob("task-overdue-digest", at("2031-06-04", "09:00"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `task-overdue:${p3}:2031-06-04@${f.groupId}` } })).toBe(1);
  });
});
