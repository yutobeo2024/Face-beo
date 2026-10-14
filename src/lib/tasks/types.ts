/**
 * Phân hệ Công việc (v1.23.0) — hằng số, nhãn tiếng Việt và kiểu DTO dùng chung server/client.
 * File này KHÔNG import prisma/luxon để trang client nhập được.
 */

export const TASK_STATUSES = ["TODO", "DOING", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { TODO: "Cần làm", DOING: "Đang làm", REVIEW: "Chờ duyệt", DONE: "Hoàn thành" };

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", URGENT: "Khẩn" };

/** Nhắc hạn cá nhân: số giờ trước hạn. */
export const REMINDERS = ["NONE", "ON_DUE", "D1", "D2", "W1"] as const;
export type Reminder = (typeof REMINDERS)[number];
export const REMINDER_LABEL: Record<Reminder, string> = { NONE: "Không nhắc", ON_DUE: "Đúng hạn", D1: "Trước 1 ngày", D2: "Trước 2 ngày", W1: "Trước 1 tuần" };
export const REMINDER_HOURS: Record<Exclude<Reminder, "NONE">, number> = { ON_DUE: 0, D1: 24, D2: 48, W1: 168 };

export const RECURRENCES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABEL: Record<Recurrence, string> = { NONE: "Không lặp", DAILY: "Hằng ngày", WEEKLY: "Hằng tuần", MONTHLY: "Hằng tháng" };

export const PROJECT_ROLES = ["OWNER", "ADMIN", "MEMBER", "CONTRIBUTOR"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = { OWNER: "Chủ dự án", ADMIN: "Quản lý dự án", MEMBER: "Thành viên", CONTRIBUTOR: "Cộng tác" };
export const PROJECT_ROLE_HINT: Record<ProjectRole, string> = {
  OWNER: "Toàn quyền; đổi tên, xóa / khôi phục, chuyển quyền sở hữu",
  ADMIN: "Toàn quyền công việc, thành viên, Zalo",
  MEMBER: "Thấy mọi việc; sửa việc mình tạo / được giao; không xóa",
  CONTRIBUTOR: "Chỉ thấy và sửa việc được giao hoặc tự tạo",
};

/** Bảng màu cố định — viết đủ tên lớp Tailwind để trình biên dịch CSS giữ lại. */
export const PROJECT_COLORS = {
  blue: { label: "Xanh dương", dot: "bg-blue-500", soft: "bg-blue-50 text-blue-700" },
  emerald: { label: "Xanh lá", dot: "bg-emerald-500", soft: "bg-emerald-50 text-emerald-700" },
  amber: { label: "Vàng", dot: "bg-amber-500", soft: "bg-amber-50 text-amber-700" },
  rose: { label: "Hồng", dot: "bg-rose-500", soft: "bg-rose-50 text-rose-700" },
  violet: { label: "Tím", dot: "bg-violet-500", soft: "bg-violet-50 text-violet-700" },
  cyan: { label: "Xanh ngọc", dot: "bg-cyan-500", soft: "bg-cyan-50 text-cyan-700" },
  orange: { label: "Cam", dot: "bg-orange-500", soft: "bg-orange-50 text-orange-700" },
  slate: { label: "Xám", dot: "bg-slate-500", soft: "bg-slate-100 text-slate-700" },
} as const;
export type ProjectColor = keyof typeof PROJECT_COLORS;
export const PROJECT_COLOR_KEYS = Object.keys(PROJECT_COLORS) as ProjectColor[];

export const ZALO_PREF_KEYS = ["onNewTask", "onStatusChange", "onTaskNearDueDate", "onNewComment", "onUserMention"] as const;
export type ZaloPrefKey = (typeof ZALO_PREF_KEYS)[number];
export type ZaloPrefs = Record<ZaloPrefKey, boolean>;
export const ZALO_PREF_LABEL: Record<ZaloPrefKey, string> = {
  onNewTask: "Có việc mới",
  onStatusChange: "Đổi trạng thái",
  onTaskNearDueDate: "Việc sắp đến hạn (trong 1 giờ) và báo cáo quá hạn 09:00",
  onNewComment: "Bình luận mới",
  onUserMention: "Nhắc tên (@mã NV) — gửi tin riêng cho người được nhắc",
};
export const DEFAULT_ZALO_PREFS: ZaloPrefs = { onNewTask: true, onStatusChange: true, onTaskNearDueDate: true, onNewComment: true, onUserMention: true };

export const NOTIFICATION_KINDS = ["TASK_ASSIGNED", "TASK_STATUS", "TASK_COMMENT", "TASK_MENTION", "TASK_DUE_SOON", "TASK_OVERDUE", "PROJECT_MEMBER"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Cờ quyền gửi cho client — CHỈ để ẩn/hiện nút; server luôn kiểm lại. */
export type ProjectPerms = {
  role: ProjectRole | null;
  manage: boolean; // thành viên, Zalo, cấu hình
  own: boolean; // đổi tên, xóa / khôi phục, chuyển quyền sở hữu
  createTask: boolean;
  deleteTask: boolean;
  seeAllTasks: boolean;
  /** Khôi phục dự án đã xóa: chủ dự án hoặc người quản lý mọi dự án. */
  restore: boolean;
  /** Đổi nhóm Zalo (route GET dự án điền thêm). */
  zaloGroup?: boolean;
};

export type TaskPerms = { edit: boolean; delete: boolean; assign: boolean; comment: boolean };

export type PersonDto = { id: number; code: string; name: string; avatarUrl: string | null; active: boolean };
export type MemberDto = PersonDto & { role: ProjectRole };

export type ProjectDto = {
  id: number;
  name: string;
  color: ProjectColor;
  description: string;
  ownerId: number;
  zaloGroupId: string | null;
  zaloPrefs: ZaloPrefs;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  myRole: ProjectRole | null;
  counts?: { total: number; done: number; overdue: number; members: number };
};

export type SubtaskDto = { id: number; text: string; done: boolean; sortOrder: number };

export type TaskDto = {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueAt: string;
  reminder: Reminder;
  recurrence: Recurrence;
  recurrenceTime: string | null;
  parentId: number | null;
  occurrenceDate: string | null;
  completedAt: string | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  assignees: PersonDto[];
  subtasks: SubtaskDto[];
  dependsOn: number[];
  commentCount: number;
  perms: TaskPerms;
};

export type CommentDto = { id: number; taskId: number; text: string; createdAt: string; author: PersonDto | null; mentions: number[] };

export type InAppNotificationDto = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  projectId: number | null;
  taskId: number | null;
  readAt: string | null;
  createdAt: string;
};

/** Đường dẫn mở một việc (deep link từ Zalo / chuông). */
export const taskHref = (projectId: number, taskId?: number | null) => (taskId ? `/me/tasks/${projectId}?task=${taskId}` : `/me/tasks/${projectId}`);

export const isOverdue = (t: { status: string; dueAt: string | Date }, now: Date = new Date()) =>
  t.status !== "DONE" && new Date(t.dueAt).getTime() < now.getTime();
