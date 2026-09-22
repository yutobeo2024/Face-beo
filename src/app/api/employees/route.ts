import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { employeeCreateSchema, optId } from "@/lib/validators";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";
import { assertCanCreate } from "@/lib/employee-guards";
import { announce } from "@/lib/announce";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { PERSONAL_KEYS, canSeePersonal, createEmployee, maskPersonal } from "@/lib/employees";
import { exemptInfo, keepTrackedUnlessAdmin } from "@/lib/attendance-scope";
import { avatarUrlFor, canViewSnapshots } from "@/lib/face-avatar";

const listQuery = z.object({
  departmentId: optId,
  jobTitleId: optId,
  specialtyId: optId,
  q: z.string().trim().max(50).optional(),
  includeInactive: z.enum(["0", "1"]).optional(),
});

export const GET = handle(async (req) => {
  const u = await requirePerm(req, ["employees.view", "employees.manage"]);
  const q = parseQuery(req, listQuery);
  const [manage, snaps] = await Promise.all([can(u, "employees.manage"), canViewSnapshots(u)]);
  const rows = await prisma.employee.findMany({
    where: {
      ...employeeScopeWhere(u, q.departmentId),
      ...(q.includeInactive === "1" && manage ? {} : { active: true }),
      // Tìm theo SĐT chỉ cho người được xem SĐT; không tìm theo CCCD.
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { code: { contains: q.q } }, ...(canSeePersonal(u) ? [{ phone: { contains: q.q } }] : [])] } : {}),
      ...(q.jobTitleId ? { jobTitleId: q.jobTitleId } : {}),
      ...(q.specialtyId ? { specialtyId: q.specialtyId } : {}),
    },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      nationalId: true,
      dateOfBirth: true,
      gender: true,
      address: true,
      role: true,
      active: true,
      departmentId: true,
      department: { select: { name: true, attendanceExempt: true } },
      attendanceExempt: true,
      defaultShiftId: true,
      defaultShift: { select: { name: true, startTime: true, endTime: true } },
      scheduleType: true,
      workPatternId: true,
      workPattern: { select: { name: true } },
      jobTitleId: true,
      jobTitle: { select: { name: true } },
      specialtyId: true,
      specialty: { select: { name: true } },
      zaloUserId: true,
      zaloLinkedAt: true,
      biometricConsentAt: true,
      lockedUntil: true,
      faceTemplates: { select: { modelVersion: true } },
      faceAvatarKey: true,
      faceAvatarAt: true,
      _count: { select: { schedules: true } },
    },
  });
  return json({
    employees: rows.map(({ faceTemplates, zaloUserId, _count, faceAvatarKey, faceAvatarAt, ...raw }) => {
      // Thông tin cá nhân (SĐT, CCCD, ngày sinh, giới tính, địa chỉ): chỉ người có quyền quản lý nhân viên và chính chủ thấy.
      const e = maskPersonal(raw, u);
      const current = faceTemplates.filter((t) => t.modelVersion === FACE_MODEL_VERSION).length;
      return {
        ...e,
        zaloLinked: !!zaloUserId,
        // v1.12.0: chế độ chấm công hiệu lực (đặt riêng thắng cấu hình phòng).
        attendance: exemptInfo({ attendanceExempt: raw.attendanceExempt, department: raw.department }),
        // Ảnh khuôn mặt đại diện (v1.10.0): chỉ chính chủ và người xem được snapshot trong phạm vi phòng.
        avatarUrl: avatarUrlFor(u, { id: raw.id, departmentId: raw.departmentId, faceAvatarKey, faceAvatarAt }, snaps),
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
  // Người không phải Nhân sự / Quản trị không đặt thông tin cá nhân của người khác.
  if (!canSeePersonal(u)) for (const k of PERSONAL_KEYS) delete (body as Record<string, unknown>)[k];
  const { employee: e, tempPassword } = await createEmployee(body, u.id);
  await keepTrackedUnlessAdmin(u.role, [e.id]); // tạo vào phòng "không chấm công": chỉ Quản trị được miễn
  await announce(u, `đã tạo nhân viên ${e.code} — ${e.name}`, { key: `emp-create:${e.id}`, detail: `Vai trò: ${ROLE_LABEL[e.role as Role] ?? e.role}` });
  return json({ employee: { id: e.id, code: e.code }, ...(tempPassword ? { tempPassword } : {}) }, { status: 201 });
});
