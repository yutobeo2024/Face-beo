import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { canViewEmployee, requireUser } from "@/lib/auth";
import { employeeUpdateSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { requirePerm } from "@/lib/permissions";
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
  if (resetPassword) {
    data.passwordHash = await bcrypt.hash("123456", 10);
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
  if (changes.length) {
    await announce(u, `đã sửa hồ sơ ${e.code} — ${e.name}`, { key: onceKey("emp-update", id), detail: changes.join("; ") });
  }
  return json({ ok: true });
});
