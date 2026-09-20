/**
 * Thư viện liên kết ("Thông tin" trong trang cá nhân).
 *
 * Quy tắc hiển thị cho nhân viên: liên kết `active` VÀ (visibleDeptIds rỗng HOẶC chứa phòng của họ)
 * VÀ (visibleRoles rỗng HOẶC chứa vai trò của họ). Mảng rỗng = tất cả.
 *
 * Phạm vi quản lý: HR/ADMIN toàn công ty. MANAGER được cấp `links.manage` chỉ tạo/sửa/xóa liên kết
 * gắn với phòng mình phụ trách (bắt buộc chọn ≥ 1 phòng, mọi phòng đều trong phạm vi) — cùng luật với assertDept.
 */
import type { InfoLink } from "@prisma/client";
import { prisma } from "./db";
import { badRequest, forbidden } from "./api";
import { canManageDept, deptScope, type AuthUser } from "./auth";

function parseArray<T>(raw: string, guard: (v: unknown) => v is T): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(guard) : [];
  } catch {
    return [];
  }
}
export const parseIds = (raw: string) => parseArray(raw, (v): v is number => typeof v === "number" && Number.isInteger(v));
export const parseRoles = (raw: string) => parseArray(raw, (v): v is string => typeof v === "string");

export type InfoLinkDto = ReturnType<typeof toDto>;
export function toDto(row: InfoLink) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description,
    icon: row.icon,
    color: row.color,
    order: row.order,
    active: row.active,
    visibleRoles: parseRoles(row.visibleRoles),
    visibleDeptIds: parseIds(row.visibleDeptIds),
    updatedAt: row.updatedAt,
  };
}

/** Người xem có thấy liên kết này không. */
export function isVisibleTo(row: Pick<InfoLink, "active" | "visibleRoles" | "visibleDeptIds">, viewer: { role: string; departmentId: number }): boolean {
  if (!row.active) return false;
  const roles = parseRoles(row.visibleRoles);
  const depts = parseIds(row.visibleDeptIds);
  return (roles.length === 0 || roles.includes(viewer.role)) && (depts.length === 0 || depts.includes(viewer.departmentId));
}

/** Liên kết có nằm trọn trong phạm vi quản lý của người dùng không (HR/ADMIN: luôn đúng). */
export function inScope(u: AuthUser, deptIds: number[]): boolean {
  const s = deptScope(u);
  if (s === null) return true;
  return deptIds.length > 0 && deptIds.every((d) => s.includes(d));
}

/** Kiểm tra phạm vi phòng ban khi tạo/sửa. Quản lý phải chọn ít nhất một phòng mình phụ trách. */
export function assertLinkScope(u: AuthUser, deptIds: number[]) {
  if (deptScope(u) === null) return;
  if (deptIds.length === 0) throw forbidden("Quản lý phải chọn ít nhất một phòng ban mình phụ trách để hiển thị liên kết");
  for (const d of deptIds) if (!canManageDept(u, d)) throw forbidden("Chỉ được gắn liên kết với phòng ban bạn quản lý");
}

/** Mọi id phòng ban phải tồn tại. */
export async function assertDeptsExist(deptIds: number[]) {
  if (deptIds.length === 0) return;
  const found = await prisma.department.count({ where: { id: { in: deptIds } } });
  if (found !== new Set(deptIds).size) throw badRequest("Có phòng ban không tồn tại");
}

export const uniqIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
