import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { can, requirePerm } from "@/lib/permissions";
import { assertDept } from "@/lib/auth";

/** Ghi nhận đồng ý xử lý dữ liệu sinh trắc học (ADMIN thao tác khi nhân viên tick đồng ý tại chỗ). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "faces.enroll");
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e || !e.active) throw notFound();
  assertDept(u, e.departmentId);
  const at = new Date();
  await prisma.employee.update({ where: { id }, data: { biometricConsentAt: at } });
  await audit({ actorId: u.id, action: "CONSENT_GIVEN", entity: "Employee", entityId: id, detail: { at } });
  return json({ ok: true, biometricConsentAt: at });
});

/** Rút lại đồng ý: xóa ngay mọi mẫu khuôn mặt, chuyển sang chấm công thủ công. Nhân viên tự rút hoặc ADMIN. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound();
  // Nhân viên tự rút đồng ý, hoặc người có quyền enroll trong phạm vi phòng ban.
  if (u.id !== id) {
    if (!(await can(u, "faces.enroll"))) throw forbidden();
    assertDept(u, e.departmentId);
  }
  const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
  await prisma.employee.update({ where: { id }, data: { biometricConsentAt: null } });
  invalidateFaceCache();
  await audit({ actorId: u.id, action: "CONSENT_WITHDRAWN", entity: "Employee", entityId: id, detail: { deletedTemplates: del.count } });
  return json({ ok: true, deletedTemplates: del.count });
});
