import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { deptScope, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const s = deptScope(u);
  const rows = await prisma.department.findMany({
    where: s === null ? {} : u.role === "MANAGER" ? { id: { in: s } } : { id: u.departmentId },
    orderBy: { id: "asc" },
    select: { id: true, name: true, managerId: true, manager: { select: { name: true, code: true } }, _count: { select: { employees: { where: { active: true } } } } },
  });
  return json({ departments: rows.map(({ _count, ...d }) => ({ ...d, employeeCount: _count.employees })) });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "org.manage");
  const { name } = await parseJson(req, z.object({ name: z.string().trim().min(2).max(80) }));
  if (await prisma.department.findUnique({ where: { name } })) throw badRequest("Tên phòng ban đã tồn tại");
  const d = await prisma.department.create({ data: { name } });
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "Department", entityId: d.id, detail: { name } });
  return json({ department: d }, { status: 201 });
});
