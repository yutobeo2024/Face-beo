import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { forbidden, unauthorized } from "./api";
import { SESSION_COOKIE, type Role } from "./roles";
import { verifySession } from "./session";

export type AuthUser = {
  id: number;
  code: string;
  name: string;
  role: Role;
  departmentId: number;
  managedDeptIds: number[];
  mustChangePassword: boolean;
};

/** Nạp người dùng từ phiên; phiên đã bị thu hồi (đổi/đặt lại mật khẩu, đăng xuất) hoặc tài khoản ngừng hoạt động => null. */
async function loadUser(s: { sub: string; sv?: number }): Promise<AuthUser | null> {
  const id = Number(s.sub);
  if (!Number.isInteger(id)) return null;
  const e = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      role: true,
      active: true,
      departmentId: true,
      mustChangePassword: true,
      sessionVersion: true,
      managedDepartments: { select: { id: true } },
    },
  });
  if (!e || !e.active || e.sessionVersion !== (s.sv ?? 0)) return null;
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    role: e.role as Role,
    departmentId: e.departmentId,
    managedDeptIds: e.managedDepartments.map((d) => d.id),
    mustChangePassword: e.mustChangePassword,
  };
}

export async function userFromRequest(req: NextRequest): Promise<AuthUser | null> {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return s ? loadUser(s) : null;
}

/**
 * Kiểm tra đăng nhập + vai trò ở server. Người phải đổi mật khẩu chỉ được gọi các API có `allowMustChange`.
 */
export async function requireUser(
  req: NextRequest,
  roles?: Role[],
  opts: { allowMustChange?: boolean } = {},
): Promise<AuthUser> {
  const u = await userFromRequest(req);
  if (!u) throw unauthorized();
  if (u.mustChangePassword && !opts.allowMustChange) throw forbidden("Bạn cần đổi mật khẩu trước");
  if (roles && !roles.includes(u.role)) throw forbidden();
  return u;
}

/** Phạm vi phòng ban (gắn theo vai trò, không theo ma trận quyền): null = toàn công ty (ADMIN, HR); mảng = các phòng MANAGER quản lý; EMPLOYEE = []. */
export function deptScope(u: AuthUser): number[] | null {
  if (u.role === "ADMIN" || u.role === "HR") return null;
  if (u.role === "MANAGER") return u.managedDeptIds;
  return [];
}

export function canManageDept(u: AuthUser, departmentId: number): boolean {
  const s = deptScope(u);
  return s === null || s.includes(departmentId);
}

/** Người dùng xem được dữ liệu của nhân viên này không (chính mình, quản lý phòng, hoặc ADMIN). */
export function canViewEmployee(u: AuthUser, emp: { id: number; departmentId: number }): boolean {
  return u.id === emp.id || canManageDept(u, emp.departmentId);
}

export function assertDept(u: AuthUser, departmentId: number) {
  if (!canManageDept(u, departmentId)) throw forbidden("Nhân viên không thuộc phòng ban bạn quản lý");
}

/** Bộ lọc Prisma cho Employee theo phạm vi. */
export function employeeScopeWhere(u: AuthUser, departmentId?: number | null) {
  const s = deptScope(u);
  if (s === null) return departmentId ? { departmentId } : {};
  if (departmentId) return s.includes(departmentId) ? { departmentId } : { id: -1 };
  return { departmentId: { in: s } };
}

// ----- Dùng trong Server Component / layout -----

export async function getPageUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  return s ? loadUser(s) : null;
}

export async function requirePageUser(): Promise<AuthUser> {
  const u = await getPageUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/login?change=1");
  return u;
}
