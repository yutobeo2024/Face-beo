/** v1.23.0 — chuông trong app theo người, Zalo nhóm dự án (mô phỏng, đếm NotificationLog), tắt cờ ⇒ 0 tin, nhắc tên @mã. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setupTasksFixture } from "./tasks-fixture";

const f = setupTasksFixture("TN");
const P = (id: number) => ({ id: String(id) });
let pid = 0;
const groupLogs = (messageType: string) => prisma.notificationLog.count({ where: { toGroupId: f.groupId, messageType } });
const bells = (who: "E1" | "E2" | "E3" | "MGR", kind?: string) => prisma.inAppNotification.count({ where: { employeeId: f.users[who], ...(kind ? { kind } : {}) } });

beforeAll(async () => {
  pid = await f.project("MGR", { E1: "MEMBER", E2: "MEMBER", E3: "CONTRIBUTOR" }, { zaloGroupId: f.groupId });
});

describe("việc mới", () => {
  it("người được giao nhận chuông (trừ chính người tạo); nhóm Zalo nhận 1 tin, KHÔNG kèm mô tả", async () => {
    const before = await groupLogs("TASK_NEW");
    const t = await f.task("MGR", pid, { title: `${f.tag} báo giá`, description: "BÍ-MẬT-NỘI-BỘ", assigneeIds: [f.users.E1, f.users.MGR] });
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_ASSIGNED", employeeId: f.users.E1 } })).toBe(1);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.MGR } })).toBe(0);
    expect(await groupLogs("TASK_NEW")).toBe(before + 1);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { dedupeKey: `task-new:${t.id}@${f.groupId}` } });
    expect(log.status).toBe("SIMULATED");
    expect(log.payload).toContain("báo giá");
    expect(log.payload).not.toContain("BÍ-MẬT");
  });
  it("tắt cờ 'Có việc mới' ⇒ không gửi nhóm (chuông vẫn có)", async () => {
    await f.ok(f.as("MGR", "tasks/projects/[id]", "PATCH", { zaloPrefs: { onNewTask: false } }, P(pid)));
    const before = await groupLogs("TASK_NEW");
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E2] });
    expect(await groupLogs("TASK_NEW")).toBe(before);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.E2 } })).toBe(1);
    await f.ok(f.as("MGR", "tasks/projects/[id]", "PATCH", { zaloPrefs: { onNewTask: true } }, P(pid)));
  });
  it("giao thêm người qua PATCH ⇒ chỉ người MỚI nhận chuông", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1] });
    const e1 = await bells("E1");
    await f.ok(f.as("MGR", "tasks/[id]", "PATCH", { assigneeIds: [f.users.E1, f.users.E2] }, P(t.id)));
    expect(await bells("E1")).toBe(e1);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.E2, kind: "TASK_ASSIGNED" } })).toBe(1);
  });
});

describe("đổi trạng thái + bình luận", () => {
  it("đổi trạng thái: người liên quan nhận chuông, nhóm nhận tin; dự án không có nhóm thì không gửi Zalo", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1] });
    const before = await groupLogs("TASK_STATUS");
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DOING" }, P(t.id)));
    expect(await groupLogs("TASK_STATUS")).toBe(before + 1);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_STATUS", employeeId: f.users.E1 } })).toBe(1);
    const noGroup = await f.project("MGR");
    const t2 = await f.task("MGR", noGroup);
    const all = await prisma.notificationLog.count({ where: { messageType: "TASK_STATUS" } });
    await f.ok(f.as("MGR", "tasks/[id]/status", "POST", { status: "DOING" }, P(t2.id)));
    expect(await prisma.notificationLog.count({ where: { messageType: "TASK_STATUS" } })).toBe(all);
  });
  it("nhắc @mã: người được nhắc nhận chuông + tin riêng; Cộng tác không thấy việc thì không được nhắc", async () => {
    const t = await f.task("MGR", pid, { assigneeIds: [f.users.E1] });
    const r = await f.ok<{ comments: { mentions: number[]; text: string }[] }>(
      f.as("E1", "tasks/[id]/comments", "POST", { text: `@${f.codes.E2.toLowerCase()} xem giúp, cả @${f.codes.E3}` }, P(t.id)),
      201,
    );
    expect(r.comments.at(-1)!.mentions).toEqual([f.users.E2]);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_MENTION", employeeId: f.users.E2 } })).toBe(1);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, employeeId: f.users.E3 } })).toBe(0);
    expect(await prisma.notificationLog.count({ where: { messageType: "TASK_MENTION", toEmployeeId: f.users.E2 } })).toBe(1);
    // Người tạo (MGR) nhận chuông "bình luận"; nhóm nhận 1 tin, không chứa nội dung bình luận.
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_COMMENT", employeeId: f.users.MGR } })).toBe(1);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { toGroupId: f.groupId, messageType: "TASK_COMMENT" }, orderBy: { id: "desc" } });
    expect(log.payload).not.toContain("xem giúp");
  });
  it("tắt 'Nhắc tên' ⇒ không gửi tin riêng (chuông vẫn có)", async () => {
    await f.ok(f.as("MGR", "tasks/projects/[id]", "PATCH", { zaloPrefs: { onUserMention: false, onNewComment: false } }, P(pid)));
    const t = await f.task("MGR", pid);
    const priv = await prisma.notificationLog.count({ where: { messageType: "TASK_MENTION" } });
    const grp = await groupLogs("TASK_COMMENT");
    await f.ok(f.as("MGR", "tasks/[id]/comments", "POST", { text: `@${f.codes.E1} nhé` }, P(t.id)), 201);
    expect(await prisma.notificationLog.count({ where: { messageType: "TASK_MENTION" } })).toBe(priv);
    expect(await groupLogs("TASK_COMMENT")).toBe(grp);
    expect(await prisma.inAppNotification.count({ where: { taskId: t.id, kind: "TASK_MENTION", employeeId: f.users.E1 } })).toBe(1);
  });
});

describe("chuông", () => {
  it("chỉ thấy của mình; đếm chưa đọc; đánh dấu đã đọc không đụng của người khác", async () => {
    const mine = await f.ok<{ notifications: { id: number }[]; unread: number }>(f.as("E2", "tasks/notifications"));
    expect(mine.unread).toBeGreaterThan(0);
    const other = await prisma.inAppNotification.findFirstOrThrow({ where: { employeeId: f.users.E1, readAt: null } });
    await f.ok(f.as("E2", "tasks/notifications/read", "POST", { ids: [mine.notifications[0].id, other.id] }));
    expect((await prisma.inAppNotification.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull();
    await f.ok(f.as("E2", "tasks/notifications/read", "POST", { all: true }));
    expect((await f.ok<{ unread: number }>(f.as("E2", "tasks/notifications"))).unread).toBe(0);
    expect((await f.as("E2", "tasks/notifications/read", "POST", {})).status).toBe(400);
  });
});
