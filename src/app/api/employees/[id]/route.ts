import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { canViewEmployee, requireUser } from "@/lib/auth";
import { employeeUpdateSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";
import { assertCanModify } from "@/lib/employee-guards";
import { announce, onceKey } from "@/lib/announce";
import { ROLE_LABEL, type Role } from "@/lib/roles";

export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      role: true,
      active: true,
      departmentId: true,
      department: { select: { name: true } },
      defaultShiftId: true,
      zaloLinkedAt: true,
      biometricConsentAt: true,
      faceTemplates: { select: { modelVersion: true, createdAt: true } },
    },
  });
  if (!e) throw notFound();
  if (!canViewEmployee(u, e)) throw forbidden();
  const { faceTemplates, ...rest } = e;
  if (e.id !== u.id && !(await can(u, "employees.manage"))) (rest as { phone?: string }).phone = undefined;
  return json({
    employee: {
      ...rest,
      faceCount: faceTemplates.filter((t) => t.modelVersion === FACE_MODEL_VERSION).length,
      faceEnrolledAt: faceTemplates[0]?.createdAt ?? null,
    },
  });
});

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "employees.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, employeeUpdateSchema);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound();
  await assertCanModify(u, e, { role: body.role, active: body.active, departmentId: body.departmentId });
  if (body.phone && body.phone !== e.phone && (await prisma.employee.findUnique({ where: { phone: body.phone } }))) {
    throw badRequest("Số điện thoại đã tồn tại");
  }
  const { resetPassword, unlinkZalo, ...fields } = body;
  const data: Record<string, unknown> = { ...fields };
  // Mật khẩu tạm ngẫu nhiên (không dùng mật khẩu mặc định đoán được), bắt buộc đổi ở lần đăng nhập sau.
  const tempPassword = resetPassword ? randomTempPassword() : null;
  if (resetPassword) {
    data.passwordHash = await bcrypt.hash(tempPassword!, 10);
    data.mustChangePassword = true;
    data.failedLogins = 0;
    data.lockedUntil = null;
  }
  if (unlinkZalo) {
    data.zaloUserId = null;
    data.zaloLinkedAt = null;
  }
  // Đổi vai trò khỏi MANAGER: gỡ khỏi vị trí quản lý phòng.
  if (fields.role && fields.role !== "MANAGER" && e.role === "MANAGER") {
    await prisma.department.updateMany({ where: { managerId: id }, data: { managerId: null } });
  }
  await prisma.employee.update({ where: { id }, data });
  // Nghỉ việc: xóa dữ liệu khuôn mặt (PRD mục 9).
  if (fields.active === false) {
    const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
    await prisma.department.updateMany({ where: { managerId: id }, data: { managerId: null } });
    if (del.count) {
      invalidateFaceCache();
      await audit({ actorId: u.id, action: "FACE_DELETE", entity: "Employee", entityId: id, detail: { reason: "inactive", count: del.count } });
    }
  }
  await audit({
    actorId: u.id,
    action: resetPassword ? "PASSWORD_RESET" : "EMPLOYEE_UPDATE",
    entity: "Employee",
    entityId: id,
    detail: { ...fields, resetPassword: !!resetPassword, unlinkZalo: !!unlinkZalo },
  });
  const changes: string[] = [];
  if (fields.role && fields.role !== e.role) changes.push(`vai trò ${ROLE_LABEL[e.role as Role] ?? e.role} → ${ROLE_LABEL[fields.role as Role]}`);
  if (fields.departmentId && fields.departmentId !== e.departmentId) changes.push("đổi phòng ban");
  if (fields.defaultShiftId && fields.defaultShiftId !== e.defaultShiftId) changes.push("đổi ca mặc định");
  if (fields.name && fields.name !== e.name) changes.push("đổi họ tên");
  if (fields.phone && fields.phone !== e.phone) changes.push("đổi số điện thoại");
  if (fields.active === false && e.active) changes.push("CHO NGHỈ VIỆC (đã xóa dữ liệu khuôn mặt)");
  if (fields.active === true && !e.active) changes.push("kích hoạt lại tài khoản");
  if (resetPassword) changes.push("đặt lại mật khẩu");
  if (unlinkZalo) changes.push("hủy liên kết Zalo");
  // Sửa hồ sơ của chính mình (SĐT, hủy Zalo...) là thao tác ngang quyền nhân viên — không công khai vào nhóm.
  const selfPersonal = id === u.id && !fields.role && fields.active === undefined && !fields.departmentId;
  if (changes.length && !selfPersonal) {
    await announce(u, `đã sửa hồ sơ ${e.code} — ${e.name}`, { key: onceKey("emp-update", id), detail: changes.join("; ") });
  }
  return json({ ok: true, ...(tempPassword ? { tempPassword } : {}) });
});

function randomTempPassword() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const D = "23456789";
  const pick = (s: string) => s[randomInt(0, s.length)];
  return Array.from({ length: 6 }, () => pick(A)).join("") + pick(D) + pick(D);
}
