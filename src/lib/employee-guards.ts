/**
 * Luật chống leo thang quyền khi quản lý tài khoản (khóa cứng, không nằm trong ma trận phân quyền).
 *  - Chỉ người có `roles.assignPrivileged` (ADMIN) mới gán vai trò HR/ADMIN hoặc sửa tài khoản HR/ADMIN.
 *  - Không ai tự đổi vai trò hay tự khóa chính mình.
 *  - Phạm vi phòng ban vẫn áp dụng (MANAGER được cấp employees.manage chỉ quản lý phòng mình).
 */
import { badRequest, forbidden } from "./api";
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
  const privileged = await can(actor, "roles.assignPrivileged");
  if (!privileged && isPrivileged(target.role) && actor.id !== target.id) {
    throw forbidden("Chỉ Quản trị được sửa tài khoản Nhân sự / Quản trị");
  }
  if (!privileged && change.role && change.role !== target.role && isPrivileged(change.role)) {
    throw forbidden("Chỉ Quản trị được gán vai trò Nhân sự / Quản trị");
  }
}
