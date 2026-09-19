import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  managerId: z.number().int().positive().nullable().optional(),
});

/** Đổi tên hoặc gán quản lý phòng ban. Người được gán tự lên vai trò MANAGER nếu đang là EMPLOYEE. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, schema);
  const d = await prisma.department.findUnique({ where: { id } });
  if (!d) throw notFound();
  if (body.managerId) {
    const m = await prisma.employee.findUnique({ where: { id: body.managerId } });
    if (!m || !m.active) throw badRequest("Quản lý không hợp lệ");
    if (m.role === "EMPLOYEE") await prisma.employee.update({ where: { id: m.id }, data: { role: "MANAGER" } });
  }
  await prisma.department.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "Department", entityId: id, detail: body });
  return json({ ok: true });
});
