import { prisma } from "@/lib/db";
import { forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { invalidateFaceCache } from "@/lib/face-matcher";

/** Ghi nhận đồng ý xử lý dữ liệu sinh trắc học (ADMIN thao tác khi nhân viên tick đồng ý tại chỗ). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e || !e.active) throw notFound();
  const at = new Date();
  await prisma.employee.update({ where: { id }, data: { biometricConsentAt: at } });
  await audit({ actorId: u.id, action: "CONSENT_GIVEN", entity: "Employee", entityId: id, detail: { at } });
  return json({ ok: true, biometricConsentAt: at });
});

/** Rút lại đồng ý: xóa ngay mọi mẫu khuôn mặt, chuyển sang chấm công thủ công. Nhân viên tự rút hoặc ADMIN. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  if (u.role !== "ADMIN" && u.id !== id) throw forbidden();
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound();
  const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
  await prisma.employee.update({ where: { id }, data: { biometricConsentAt: null } });
  invalidateFaceCache();
  await audit({ actorId: u.id, action: "CONSENT_WITHDRAWN", entity: "Employee", entityId: id, detail: { deletedTemplates: del.count } });
  return json({ ok: true, deletedTemplates: del.count });
});
