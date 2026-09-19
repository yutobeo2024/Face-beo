export const ROLES = ["ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Quản trị",
  HR: "Nhân sự",
  MANAGER: "Quản lý",
  EMPLOYEE: "Nhân viên",
};

export const REQUEST_TYPES = ["NGHI_PHEP", "VE_SOM", "TANG_CA_OT"] as const;
export type RequestTypeT = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABEL: Record<RequestTypeT, string> = {
  NGHI_PHEP: "Nghỉ phép",
  VE_SOM: "Về sớm",
  TANG_CA_OT: "Tăng ca (OT)",
};

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type RequestStatusT = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABEL: Record<RequestStatusT, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  CANCELLED: "Đã hủy",
};

export const SESSION_COOKIE = "fb_session";
export const KIOSK_COOKIE = "fb_kiosk";

/** Phiên bản mô hình embedding khuôn mặt. Đổi mô hình => tăng số, template cũ bị bỏ qua. */
export const FACE_MODEL_VERSION = "human-3.3-faceres-v1";

/** Vai trò đặc quyền: chỉ người có quyền `roles.assignPrivileged` (ADMIN) mới gán hoặc sửa tài khoản mang vai trò này. */
export const PRIVILEGED_ROLES: readonly Role[] = ["ADMIN", "HR"];
