import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BASELINE_DATE, snapshotAssignment } from "@/lib/schedule-assignments";
import { badRequest, handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { employeeCreateSchema, optId } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";
import { assertCanCreate } from "@/lib/employee-guards";
import { announce } from "@/lib/announce";
import { ROLE_LABEL, type Role } from "@/lib/roles";

const listQuery = z.object({
  departmentId: optId,
  q: z.string().trim().max(50).optional(),
  includeInactive: z.enum(["0", "1"]).optional(),
});

export const GET = handle(async (req) => {
  const u = await requirePerm(req, ["employees.view", "employees.manage"]);
  const q = parseQuery(req, listQuery);
  const manage = await can(u, "employees.manage");
  const rows = await prisma.employee.findMany({
    where: {
      ...employeeScopeWhere(u, q.departmentId),
      ...(q.includeInactive === "1" && manage ? {} : { active: true }),
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { code: { contains: q.q } }, { phone: { contains: q.q } }] } : {}),
    },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
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
      defaultShift: { select: { name: true, startTime: true, endTime: true } },
      scheduleType: true,
      workPatternId: true,
      workPattern: { select: { name: true } },
      zaloUserId: true,
      zaloLinkedAt: true,
      biometricConsentAt: true,
      lockedUntil: true,
      faceTemplates: { select: { modelVersion: true } },
      _count: { select: { schedules: true } },
    },
  });
  return json({
    employees: rows.map(({ faceTemplates, zaloUserId, _count, ...e }) => {
      const current = faceTemplates.filter((t) => t.modelVersion === FACE_MODEL_VERSION).length;
      return {
        ...e,
        phone: manage ? e.phone : undefined,
        zaloLinked: !!zaloUserId,
        faceCount: current,
        faceStatus: current > 0 ? "ENROLLED" : faceTemplates.length > 0 ? "REENROLL" : "NONE",
        hasSchedules: _count.schedules > 0,
        rotating: e.scheduleType === "ROTATING",
      };
    }),
  });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "employees.manage");
  const body = await parseJson(req, employeeCreateSchema);
  await assertCanCreate(u, body);
  const dup = await prisma.employee.findFirst({ where: { OR: [{ code: body.code.toUpperCase() }, { phone: body.phone }] } });
  if (dup) throw badRequest(dup.phone === body.phone ? "Số điện thoại đã tồn tại" : "Mã nhân viên đã tồn tại");
  if (!(await prisma.shift.findUnique({ where: { id: body.defaultShiftId } }))) throw badRequest("Ca mặc định không tồn tại");
  if (!(await prisma.department.findUnique({ where: { id: body.departmentId } }))) throw badRequest("Phòng ban không tồn tại");
  if (body.workPatternId && !(await prisma.workPattern.findUnique({ where: { id: body.workPatternId } }))) throw badRequest("Mẫu tuần không tồn tại");
  const e = await prisma.employee.create({
    data: {
      code: body.code.toUpperCase(),
      name: body.name,
      phone: body.phone,
      role: body.role,
      departmentId: body.departmentId,
      defaultShiftId: body.defaultShiftId,
      scheduleType: body.scheduleType ?? "FIXED",
      workPatternId: (body.scheduleType ?? "FIXED") === "FIXED" ? (body.workPatternId ?? null) : null,
      passwordHash: await bcrypt.hash(body.password || "123456", 10),
      mustChangePassword: true,
    },
  });
  await snapshotAssignment(e.id, BASELINE_DATE);
  await audit({ actorId: u.id, action: "EMPLOYEE_CREATE", entity: "Employee", entityId: e.id, detail: { code: e.code, role: e.role } });
  await announce(u, `đã tạo nhân viên ${e.code} — ${e.name}`, { key: `emp-create:${e.id}`, detail: `Vai trò: ${ROLE_LABEL[e.role as Role] ?? e.role}` });
  return json({ employee: { id: e.id, code: e.code } }, { status: 201 });
});
