export const ROLES = ["ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Quản trị",
  HR: "Nhân sự",
  MANAGER: "Quản lý",
  EMPLOYEE: "Nhân viên",
};

export const REQUEST_TYPES = ["NGHI_PHEP", "VE_SOM", "TANG_CA_OT", "BO_SUNG_CONG"] as const;
export type RequestTypeT = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABEL: Record<RequestTypeT, string> = {
  NGHI_PHEP: "Nghỉ phép",
  VE_SOM: "Về sớm",
  TANG_CA_OT: "Tăng ca (OT)",
  BO_SUNG_CONG: "Bổ sung công",
};

export const REQUEST_STATUSES = ["PENDING", "MANAGER_APPROVED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type RequestStatusT = (typeof REQUEST_STATUSES)[number];
/** Đơn còn chờ quyết định cuối (chưa có hiệu lực): chờ duyệt, hoặc trưởng phòng đã duyệt bước 1 và đang chờ Nhân sự. */
export const OPEN_REQUEST_STATUSES = ["PENDING", "MANAGER_APPROVED"] as const;
export const isOpenRequest = (status: string) => (OPEN_REQUEST_STATUSES as readonly string[]).includes(status);
export const REQUEST_STATUS_LABEL: Record<RequestStatusT, string> = {
  PENDING: "Chờ duyệt",
  MANAGER_APPROVED: "Chờ HR duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  CANCELLED: "Đã hủy",
};

/** Cách duyệt đơn của Nhân viên trong phòng có quản lý (cấu hình theo phòng, v1.7.0). */
export const APPROVAL_MODES = ["MANAGER_OR_HR", "TWO_STEP", "MANAGER_ONLY"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  MANAGER_OR_HR: "Trưởng phòng hoặc Nhân sự",
  TWO_STEP: "Trưởng phòng duyệt trước → Nhân sự duyệt sau",
  MANAGER_ONLY: "Chỉ trưởng phòng",
};

export const SESSION_COOKIE = "fb_session";
export const KIOSK_COOKIE = "fb_kiosk";

/** Phiên bản mô hình embedding khuôn mặt. Đổi mô hình => tăng số, template cũ bị bỏ qua. */
/** Phiên bản mô hình nhận diện (InsightFace phía server). Template khác phiên bản bị bỏ qua => phải enroll lại. */
export const FACE_MODEL_VERSION = process.env.FACE_EMBED_MODEL === "mbf" ? "insightface-w600k_mbf-v1" : "insightface-w600k_r50-v1";

/** Vai trò đặc quyền: chỉ người có quyền `roles.assignPrivileged` (ADMIN) mới gán hoặc sửa tài khoản mang vai trò này. */
export const PRIVILEGED_ROLES: readonly Role[] = ["ADMIN", "HR"];
