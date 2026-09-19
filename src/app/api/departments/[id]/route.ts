import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { can, requirePerm } from "@/lib/permissions";
import { assertCanModify } from "@/lib/employee-guards";
import { announce } from "@/lib/announce";

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
  let promoted: { code: string; name: string } | null = null;
  if (body.managerId) {
    const m = await prisma.employee.findUnique({ where: { id: body.managerId } });
    if (!m || !m.active) throw badRequest("Quản lý không hợp lệ");
    // Chống tự mở rộng phạm vi: không tự gán mình làm quản lý (trừ Quản trị); đổi vai trò đi qua luật chống leo thang.
    if (m.id === u.id && u.role !== "ADMIN") throw forbidden("Không thể tự gán mình làm quản lý phòng ban");
    if (m.role === "EMPLOYEE") {
      await assertCanModify(u, m, { role: "MANAGER" });
      await prisma.employee.update({ where: { id: m.id }, data: { role: "MANAGER" } });
      promoted = m;
    } else if (m.role !== "MANAGER" && !(await can(u, "roles.assignPrivileged"))) {
      throw forbidden("Chỉ Quản trị được gán Nhân sự / Quản trị làm quản lý phòng");
    }
  }
  await prisma.department.update({ where: { id }, data: body });
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "Department", entityId: id, detail: body });
  if (body.managerId !== undefined) {
    const m = body.managerId ? await prisma.employee.findUnique({ where: { id: body.managerId }, select: { code: true, name: true } }) : null;
    await announce(u, `đã ${m ? `gán ${m.code} — ${m.name} làm quản lý` : "gỡ quản lý"} phòng ${d.name}`, {
      key: `dept-manager:${id}:${Date.now()}`,
      detail: promoted ? "Tự động nâng vai trò Nhân viên → Quản lý" : undefined,
    });
  }
  return json({ ok: true });
});
