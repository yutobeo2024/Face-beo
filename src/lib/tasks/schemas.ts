/**
 * Schema zod của phân hệ Công việc. Luật zod 4 của repo: schema PATCH KHÔNG có `.default()` (`.partial()` vẫn áp default
 * ⇒ PATCH một trường sẽ xóa trường khác) — test `tasks-patch-regression` giữ điều này.
 */
import { z } from "zod";
import { dateStr, idNum, isoDateTime, timeStr } from "../validators";
import { DEFAULT_ZALO_PREFS, PROJECT_COLOR_KEYS, RECURRENCES, REMINDERS, TASK_PRIORITIES, TASK_STATUSES, ZALO_PREF_KEYS, type ZaloPrefs } from "./types";

const title = z.string().trim().min(1, "cần tiêu đề").max(200);
/** Ngày "YYYY-MM-DD" CÓ THẬT (30/02, tháng 13 ⇒ lỗi) — ngày hỏng lọt vào làm job việc lặp ném lỗi. */
const realDate = dateStr.refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01" && v <= "2100-12-31";
}, "ngày không tồn tại");
const description = z.string().max(5000);
const color = z.enum(PROJECT_COLOR_KEYS as [string, ...string[]]);
const zaloGroupId = z.string().trim().min(1).max(100).nullable();

export const zaloPrefsSchema = z.object(Object.fromEntries(ZALO_PREF_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof ZALO_PREF_KEYS)[number], z.ZodBoolean>);

/** Đọc cột JSON zaloPrefs; hỏng / thiếu khóa ⇒ lấy mặc định cho khóa đó. */
export function parseZaloPrefs(raw: string | null | undefined): ZaloPrefs {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(ZALO_PREF_KEYS.map((k) => [k, typeof v[k] === "boolean" ? v[k] : DEFAULT_ZALO_PREFS[k]])) as ZaloPrefs;
  } catch {
    return { ...DEFAULT_ZALO_PREFS };
  }
}

/** Đọc cột JSON mảng id (mentions). */
export function parseIdList(raw: string | null | undefined): number[] {
  try {
    const r = z.array(z.number().int().positive()).safeParse(JSON.parse(raw ?? "[]"));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2, "tên tối thiểu 2 ký tự").max(100),
  color: color.default("blue"),
  description: description.default(""),
  zaloGroupId: zaloGroupId.default(null),
  zaloPrefs: zaloPrefsSchema.optional(),
});

export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    color,
    description,
    zaloGroupId,
    zaloPrefs: zaloPrefsSchema.partial(),
  })
  .partial();

const memberRole = z.enum(["ADMIN", "MEMBER", "CONTRIBUTOR"]);
export const memberSchema = z.object({ employeeId: idNum, role: memberRole });
export const membersPutSchema = z.object({ members: z.array(memberSchema).min(1).max(50) });
export const transferOwnerSchema = z.object({ employeeId: idNum });

const status = z.enum(TASK_STATUSES);
const priority = z.enum(TASK_PRIORITIES);
const reminder = z.enum(REMINDERS);
const recurrence = z.enum(RECURRENCES);
const assigneeIds = z.array(idNum).max(20);

export const taskCreateSchema = z.object({
  title,
  description: description.default(""),
  status: status.default("TODO"),
  priority: priority.default("MEDIUM"),
  startDate: realDate.nullable().default(null),
  dueAt: isoDateTime,
  reminder: reminder.default("NONE"),
  recurrence: recurrence.default("NONE"),
  recurrenceTime: timeStr.nullable().default(null),
  assigneeIds: assigneeIds.default([]),
  subtasks: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

/** KHÔNG có `status` — trạng thái chỉ đổi qua POST /status (kiểm việc con, completedAt, xung đột 409). */
export const taskPatchSchema = z
  .object({
    title,
    description,
    priority,
    startDate: realDate.nullable(),
    dueAt: isoDateTime,
    reminder,
    recurrence,
    recurrenceTime: timeStr.nullable(),
    assigneeIds,
  })
  .partial()
  .strict();
export type TaskPatchInput = z.infer<typeof taskPatchSchema>;

export const statusSchema = z.object({ status, fromStatus: status.optional() });

export const subtasksPutSchema = z.object({
  subtasks: z
    .array(z.object({ id: idNum.optional(), text: z.string().trim().min(1).max(200), done: z.boolean() }))
    .max(50, "tối đa 50 việc con"),
});

export const dependenciesPutSchema = z.object({ dependsOn: z.array(idNum).max(20, "tối đa 20 việc phụ thuộc") });

export const commentSchema = z.object({ text: z.string().trim().min(1, "bình luận trống").max(2000) });

export const notificationsReadSchema = z.object({ ids: z.array(idNum).max(200).optional(), all: z.boolean().optional() });

const flag = z.enum(["0", "1"]).optional();

export const tasksQuerySchema = z.object({
  status: status.optional(),
  assignee: z.union([z.literal("me"), idNum]).optional(),
  q: z.string().trim().max(100).optional(),
  done: flag, // "0" = ẩn việc đã xong
});

export const myTasksQuerySchema = z.object({ due: z.enum(["overdue", "today", "week", "all"]).default("all"), done: flag });

export const projectsQuerySchema = z.object({ deleted: flag });

export const notificationsQuerySchema = z.object({ unread: flag, take: z.coerce.number().int().min(1).max(100).default(30) });

export const membersPoolQuerySchema = z.object({ projectId: idNum.optional(), q: z.string().trim().max(50).optional() });
