import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { assertShiftsExist, patternSchema } from "@/lib/work-patterns";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";

export const GET = handle(async (req) => {
  await requireUser(req);
  const patterns = await prisma.workPattern.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: { where: { active: true } } } } } });
  return json({ patterns: patterns.map(({ _count, ...p }) => ({ ...p, employeeCount: _count.employees })) });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "org.manage");
  const body = await parseJson(req, patternSchema);
  await assertShiftsExist(body);
  if (await prisma.workPattern.findUnique({ where: { name: body.name } })) throw badRequest("Tên mẫu tuần đã tồn tại");
  const p = await prisma.workPattern.create({ data: body });
  await audit({ actorId: u.id, action: "PATTERN_UPDATE", entity: "WorkPattern", entityId: p.id, detail: body });
  await announce(u, `đã tạo mẫu tuần làm việc "${p.name}"`, { key: `pattern-create:${p.id}` });
  return json({ pattern: p }, { status: 201 });
});
