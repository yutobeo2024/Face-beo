// QC v1.23.0 — Công việc: thử phá hàm thuần (schema, quyền, lặp, nhắc tên, vòng phụ thuộc). Giờ cố định.
import { describe, expect, it } from "vitest";
import { vnDateTime } from "@/lib/attendance";
import { canSetMember, effectiveRole, canViewTask, canEditTask, canAssignTask, type ProjectCtx } from "@/lib/tasks/project-access";
import { dueOccurrences, isOccurrence, shiftStartDate } from "@/lib/tasks/recurrence";
import { commentSchema, dependenciesPutSchema, membersPutSchema, parseIdList, parseZaloPrefs, projectPatchSchema, subtasksPutSchema, taskCreateSchema, taskPatchSchema } from "@/lib/tasks/schemas";
import { parseMentions, reaches } from "@/lib/tasks/tasks";
import type { ProjectRole } from "@/lib/tasks/types";

const DUE = "2030-01-10T10:00:00.000Z";
const ctx = (memberRole: ProjectRole | null, extra: Partial<ProjectCtx> = {}): ProjectCtx => ({ userId: 10, systemRole: "EMPLOYEE", manageAll: false, memberRole, ...extra });

describe("schema tạo / sửa việc", () => {
  it("PATCH từ chối mọi trường hệ thống (status, completedAt, projectId, parentId, createdById, occurrenceDate)", () => {
    for (const k of ["status", "completedAt", "projectId", "parentId", "createdById", "occurrenceDate", "id"]) {
      expect(taskPatchSchema.safeParse({ [k]: k === "status" ? "DONE" : 1 }).success, k).toBe(false);
    }
  });
  it("POST bỏ qua trường hệ thống lạ (không để client đặt createdById / parentId / completedAt)", () => {
    const r = taskCreateSchema.parse({ title: "x", dueAt: DUE, createdById: 1, parentId: 2, completedAt: DUE, occurrenceDate: "2030-01-01", projectId: 9 });
    for (const k of ["createdById", "parentId", "completedAt", "occurrenceDate", "projectId"]) expect(r, k).not.toHaveProperty(k);
  });
  it("PATCH một trường không kéo theo default của trường khác", () => {
    expect(taskPatchSchema.parse({ title: "a" })).toEqual({ title: "a" });
    expect(projectPatchSchema.parse({ color: "rose" })).toEqual({ color: "rose" });
  });
  it("PATCH dự án bỏ ownerId / deletedAt (chỉ transfer-owner / DELETE đổi được)", () => {
    const r = projectPatchSchema.parse({ ownerId: 5, deletedAt: null, createdById: 3, description: "d" });
    expect(r).toEqual({ description: "d" });
  });
  it("giới hạn độ dài / số lượng", () => {
    expect(taskCreateSchema.safeParse({ title: "x".repeat(201), dueAt: DUE }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "   ", dueAt: DUE }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, description: "x".repeat(5001) }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, subtasks: Array(51).fill("a") }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, subtasks: Array(50).fill("a") }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, assigneeIds: Array.from({ length: 21 }, (_, i) => i + 1) }).success).toBe(false);
    expect(subtasksPutSchema.safeParse({ subtasks: [{ text: "x".repeat(201), done: false }] }).success).toBe(false);
    expect(dependenciesPutSchema.safeParse({ dependsOn: Array.from({ length: 21 }, (_, i) => i + 1) }).success).toBe(false);
    expect(commentSchema.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
    expect(commentSchema.safeParse({ text: " \n\t " }).success).toBe(false);
    expect(membersPutSchema.safeParse({ members: [] }).success).toBe(false);
  });
  it("hạn / giờ lặp không hợp lệ bị chặn", () => {
    for (const dueAt of ["2030-02-30T10:00:00Z", "2030-13-01T10:00:00Z", "hôm nay", "2030-01-10", ""]) {
      expect(taskCreateSchema.safeParse({ title: "x", dueAt }).success, dueAt).toBe(false);
    }
    for (const t of ["24:00", "9:00", "09:60", "0900"]) expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, recurrenceTime: t }).success, t).toBe(false);
  });
  it("ngày bắt đầu không có thật (30/02, tháng 13) bị chặn", () => {
    // dateStr chỉ kiểm regex \d{4}-\d{2}-\d{2} ⇒ "2030-02-30" lọt qua; job lặp sau đó tính khoảng cách NaN.
    for (const startDate of ["2030-02-30", "2029-13-01", "2029-00-10", "0000-00-00"]) {
      expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, startDate }).success, startDate).toBe(false);
      expect(taskPatchSchema.safeParse({ startDate }).success, startDate).toBe(false);
    }
  });
  it("id âm / 0 / thập phân bị chặn", () => {
    for (const id of [0, -1, 1.5, "abc"]) {
      expect(dependenciesPutSchema.safeParse({ dependsOn: [id] }).success, String(id)).toBe(false);
      expect(taskCreateSchema.safeParse({ title: "x", dueAt: DUE, assigneeIds: [id] }).success, String(id)).toBe(false);
    }
  });
});

describe("đọc cột JSON hỏng", () => {
  it("zaloPrefs hỏng / sai kiểu ⇒ mặc định, không ném", () => {
    expect(parseZaloPrefs("{oops")).toMatchObject({ onNewTask: true });
    expect(parseZaloPrefs('{"onNewTask":"false"}').onNewTask).toBe(true);
    expect(parseZaloPrefs("null").onNewTask).toBe(true);
    expect(parseZaloPrefs("[]").onNewComment).toBe(true);
  });
  it("mentions hỏng ⇒ []", () => {
    expect(parseIdList("{")).toEqual([]);
    expect(parseIdList('["1"]')).toEqual([]);
    expect(parseIdList("null")).toEqual([]);
  });
});

describe("quyền — các tổ hợp hiểm", () => {
  it("Quản lý dự án không đặt OWNER, không đụng OWNER, không hạ ADMIN khác; tự hạ / tự rời được", () => {
    const a = ctx("ADMIN");
    expect(canSetMember(a, 99, "OWNER", "ADMIN")).toBe(false);
    expect(canSetMember(a, 99, "OWNER", null)).toBe(false);
    expect(canSetMember(a, 99, "MEMBER", "OWNER")).toBe(false);
    expect(canSetMember(a, 99, "ADMIN", "MEMBER")).toBe(false);
    expect(canSetMember(a, 99, "ADMIN", null)).toBe(false);
    expect(canSetMember(a, 10, "ADMIN", "CONTRIBUTOR")).toBe(true);
    expect(canSetMember(a, 99, null, "ADMIN")).toBe(true);
  });
  it("manageAll là thành viên OWNER vẫn là OWNER (không bị hạ xuống ADMIN)", () => {
    expect(effectiveRole(ctx("OWNER", { manageAll: true }))).toBe("OWNER");
    expect(effectiveRole(ctx("MEMBER", { manageAll: true }))).toBe("ADMIN");
  });
  it("người ngoài dự án không thấy / sửa việc kể cả việc mình tạo hay được giao (đã bị gỡ khỏi dự án)", () => {
    const rel = { createdById: 10, assigneeIds: [10] };
    expect(canViewTask(ctx(null), rel)).toBe(false);
    expect(canEditTask(ctx(null), rel)).toBe(false);
    expect(canAssignTask(ctx(null), rel)).toBe(false);
  });
  it("Cộng tác tự tạo việc vẫn không giao cho người khác được", () => {
    expect(canAssignTask(ctx("CONTRIBUTOR"), { createdById: 10, assigneeIds: [] })).toBe(false);
  });
});

describe("việc lặp — biên", () => {
  it("hằng tháng từ 29/02 năm nhuận: năm sau kẹp về 28/02, tháng 3 vẫn ngày 29", () => {
    expect(isOccurrence("MONTHLY", "2032-02-29", "2032-03-29")).toBe(true);
    expect(isOccurrence("MONTHLY", "2032-02-29", "2033-02-28")).toBe(true);
    expect(isOccurrence("MONTHLY", "2032-02-29", "2033-02-27")).toBe(false);
  });
  it("loại lặp lạ ⇒ không sinh bản", () => {
    expect(isOccurrence("YEARLY", "2030-01-01", "2031-01-01")).toBe(false);
    expect(dueOccurrences({ recurrence: "HOURLY", recurrenceTime: null, dueAt: vnDateTime("2030-01-01", "10:00"), startDate: null }, vnDateTime("2030-01-05", "00:10"))).toEqual([]);
  });
  it("chạy đúng 00:00 hai ngày liền: mỗi ngày đúng một bản, không sót không trùng", () => {
    const t = { recurrence: "DAILY", recurrenceTime: null, dueAt: vnDateTime("2030-01-01", "10:00"), startDate: null };
    expect(dueOccurrences(t, vnDateTime("2030-01-05", "00:00"))).toEqual(["2030-01-05"]);
    expect(dueOccurrences(t, vnDateTime("2030-01-06", "00:00"))).toEqual(["2030-01-06"]);
  });
  it("ngày bắt đầu sau hạn (dữ liệu cũ) ⇒ bản lặp bắt đầu đúng ngày lặp, không lệch sang tương lai", () => {
    expect(shiftStartDate({ startDate: "2030-01-12", dueAt: vnDateTime("2030-01-10", "10:00") }, "2030-02-01")).toBe("2030-02-01");
  });
  it("ngày bắt đầu không có thật không làm hàm ném lỗi (job lặp chạy chung cho mọi việc)", () => {
    expect(() => shiftStartDate({ startDate: "2030-02-30", dueAt: vnDateTime("2030-03-05", "10:00") }, "2030-03-06")).not.toThrow();
  });
});

describe("nhắc tên + vòng phụ thuộc", () => {
  it("không bắt email / @@ / mã quá ngắn", () => {
    expect(parseMentions("gửi a@NV01.vn")).toEqual([]);
    expect(parseMentions("@A")).toEqual([]);
    expect(parseMentions("(@nv01), @NV01; @Nv01")).toEqual(["NV01"]);
    expect(parseMentions("@" + "A".repeat(25))).toEqual([]);
  });
  it("vòng lặp dài + đồ thị có chu trình sẵn không làm DFS treo", () => {
    const edges = new Map<number, number[]>();
    for (let i = 1; i < 500; i++) edges.set(i, [i + 1]);
    edges.set(500, [1]);
    expect(reaches(edges, 1, 500)).toBe(true);
    expect(reaches(edges, 1, 9999)).toBe(false);
  });
});
