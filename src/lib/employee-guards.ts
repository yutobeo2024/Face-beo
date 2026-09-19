/**
 * Luật chống leo thang quyền khi quản lý tài khoản (khóa cứng, không nằm trong ma trận phân quyền).
 *  - Chỉ người có `roles.assignPrivileged` (ADMIN) mới gán vai trò HR/ADMIN hoặc sửa tài khoản HR/ADMIN.
 *  - Không ai tự đổi vai trò hay tự khóa chính mình.
 *  - Phạm vi phòng ban vẫn áp dụng (MANAGER được cấp employees.manage chỉ quản lý phòng mình).
 */
import { badRequest, forbidden } from "./api";
import { prisma } from "./db";
import { assertDept, type AuthUser } from "./auth";
import { can } from "./permissions";
import { PRIVILEGED_ROLES, type Role } from "./roles";

const isPrivileged = (r: string) => (PRIVILEGED_ROLES as readonly string[]).includes(r);

export async function assertCanCreate(actor: AuthUser, input: { role: string; departmentId: number }) {
  assertDept(actor, input.departmentId);
  if (isPrivileged(input.role) && !(await can(actor, "roles.assignPrivileged"))) {
    throw forbidden("Chỉ Quản trị được tạo tài khoản Nhân sự / Quản trị");
  }
}

export async function assertCanModify(
  actor: AuthUser,
  target: { id: number; role: string; departmentId: number },
  change: { role?: Role | string; active?: boolean; departmentId?: number },
) {
  assertDept(actor, target.departmentId);
  if (change.departmentId && change.departmentId !== target.departmentId) assertDept(actor, change.departmentId);
  if (actor.id === target.id) {
    if ((change.role && change.role !== target.role) || change.active === false) {
      throw badRequest("Không thể tự đổi vai trò hoặc tự khóa tài khoản của chính mình");
    }
  }
  // Người bị đổi vai trò / cho nghỉ đang quản lý phòng nào thì các phòng đó cũng phải nằm trong phạm vi người thao tác.
  if ((change.role && change.role !== target.role) || change.active === false) {
    const managed = await prisma.department.findMany({ where: { managerId: target.id }, select: { id: true } });
    for (const d of managed) assertDept(actor, d.id);
  }
  const privileged = await can(actor, "roles.assignPrivileged");
  if (!privileged && isPrivileged(target.role) && actor.id !== target.id) {
    throw forbidden("Chỉ Quản trị được sửa tài khoản Nhân sự / Quản trị");
  }
  if (!privileged && change.role && change.role !== target.role && isPrivileged(change.role)) {
    throw forbidden("Chỉ Quản trị được gán vai trò Nhân sự / Quản trị");
  }
}

/**
 * Thao tác trên dữ liệu sinh trắc (đồng ý, enroll, xóa khuôn mặt) của người khác:
 *  - trong phạm vi phòng ban;
 *  - chỉ Quản trị động được vào tài khoản Nhân sự / Quản trị;
 *  - không ai (trừ Quản trị) tự enroll khuôn mặt cho chính mình — chống đăng ký mặt người khác để chấm công hộ.
 */
export async function assertCanTouchBiometrics(actor: AuthUser, target: { id: number; role: string; departmentId: number }) {
  assertDept(actor, target.departmentId);
  if (actor.role === "ADMIN") return;
  if (actor.id === target.id) throw forbidden("Không thể tự enroll hoặc sửa dữ liệu khuôn mặt của chính mình — nhờ người khác thực hiện");
  if (isPrivileged(target.role) && !(await can(actor, "roles.assignPrivileged"))) {
    throw forbidden("Chỉ Quản trị được thao tác dữ liệu khuôn mặt của tài khoản Nhân sự / Quản trị");
  }
}
