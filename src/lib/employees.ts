/**
 * Tạo nhân viên dùng chung cho form (POST /api/employees) và nhập Excel (v1.8.0), cùng các quy tắc dữ liệu cá nhân:
 * CCCD / ngày sinh / giới tính / địa chỉ / SĐT chỉ Nhân sự-Quản trị (quyền employees.manage) và chính chủ xem; không ghi giá trị vào nhật ký.
 */
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { badRequest } from "./api";
import { BASELINE_DATE, snapshotAssignment } from "./schedule-assignments";
import { assertCatalogIds } from "./catalogs";
import { randomTempPassword } from "./temp-password";

type Tx = Prisma.TransactionClient | typeof prisma;

/** Các trường thông tin cá nhân (ẩn với người không có quyền quản lý nhân viên, trừ chính chủ). */
export const PERSONAL_KEYS = ["phone", "nationalId", "dateOfBirth", "gender", "address"] as const;
type PersonalKey = (typeof PERSONAL_KEYS)[number];

/**
 * Ai được xem / sửa thông tin cá nhân của người khác: chỉ Nhân sự và Quản trị (theo VAI TRÒ — kể cả khi Quản lý được cấp quyền
 * "Quản lý nhân viên", họ vẫn không thấy CCCD / ngày sinh / địa chỉ / SĐT). Chính chủ luôn xem được của mình.
 */
export const canSeePersonal = (u: { role: string }) => u.role === "ADMIN" || u.role === "HR";

/** Xóa thông tin cá nhân khỏi bản ghi trả về khi người xem không phải chính chủ và không phải Nhân sự / Quản trị. */
export function maskPersonal<T extends Partial<Record<PersonalKey, unknown>> & { id: number }>(e: T, viewer: { id: number; role: string }): T {
  if (canSeePersonal(viewer) || e.id === viewer.id) return e;
  const out = { ...e };
  for (const k of PERSONAL_KEYS) if (k in out) (out as Record<string, unknown>)[k] = undefined;
  return out;
}

/** Nhật ký: không lưu giá trị CCCD / ngày sinh / địa chỉ / SĐT — chỉ ghi là đã đặt hoặc đã xóa. */
export function redactPersonal<T extends Record<string, unknown>>(detail: T): T {
  const out: Record<string, unknown> = { ...detail };
  for (const k of PERSONAL_KEYS) if (k in out && out[k] !== undefined) out[k] = out[k] === null ? "(xóa)" : "(đã đặt)";
  return out as T;
}

/** Kiểm trùng mã / SĐT / CCCD (bỏ qua chính người `exceptId`). Chỉ so trường có giá trị — Prisma bỏ `undefined` sẽ khớp mọi người. */
export async function assertUniqueEmployee(input: { code?: string; phone?: string | null; nationalId?: string | null }, exceptId?: number, db: Tx = prisma) {
  const or: Prisma.EmployeeWhereInput[] = [];
  if (input.code) or.push({ code: input.code });
  if (input.phone) or.push({ phone: input.phone });
  if (input.nationalId) or.push({ nationalId: input.nationalId });
  if (!or.length) return;
  const dup = await db.employee.findFirst({ where: { OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { code: true, phone: true, nationalId: true } });
  if (!dup) return;
  if (input.code && dup.code === input.code) throw badRequest("Mã nhân viên đã tồn tại");
  if (input.phone && dup.phone === input.phone) throw badRequest(`Số điện thoại đã được dùng (${dup.code})`);
  throw badRequest(`Số CCCD đã được dùng (${dup.code})`);
}

export type NewEmployee = {
  code: string;
  name: string;
  role: string;
  departmentId: number;
  defaultShiftId: number;
  scheduleType?: "FIXED" | "ROTATING";
  workPatternId?: number | null;
  jobTitleId?: number | null;
  specialtyId?: number | null;
  phone?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  password?: string;
};

/**
 * Tạo một nhân viên (không kiểm quyền — nơi gọi đã `assertCanCreate`): kiểm trùng, kiểm danh mục, mật khẩu tạm nếu không truyền,
 * bắt đổi mật khẩu lần đầu, bản ghi phân công gốc, nhật ký. Trả về nhân viên và mật khẩu tạm (nếu có) để hiện MỘT LẦN.
 */
export async function createEmployee(input: NewEmployee, actorId: number | null, db: Tx = prisma, opts: { via?: string; passwordHash?: string } = {}) {
  const { via } = opts;
  const code = input.code.trim().toUpperCase();
  await assertUniqueEmployee({ code, phone: input.phone, nationalId: input.nationalId }, undefined, db);
  if (!(await db.shift.findUnique({ where: { id: input.defaultShiftId } }))) throw badRequest("Ca mặc định không tồn tại");
  if (!(await db.department.findUnique({ where: { id: input.departmentId } }))) throw badRequest("Phòng ban không tồn tại");
  if (input.workPatternId && !(await db.workPattern.findUnique({ where: { id: input.workPatternId } }))) throw badRequest("Mẫu tuần không tồn tại");
  await assertCatalogIds(input, db);
  const scheduleType = input.scheduleType ?? "FIXED";
  // Không có mật khẩu mặc định chung: không truyền thì sinh mật khẩu tạm ngẫu nhiên. Nhập Excel băm sẵn ngoài giao dịch (opts.passwordHash).
  const tempPassword = input.password || opts.passwordHash ? null : randomTempPassword();
  const e = await db.employee.create({
    data: {
      code,
      name: input.name.trim(),
      phone: input.phone ?? null,
      nationalId: input.nationalId ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      address: input.address ?? null,
      role: input.role,
      departmentId: input.departmentId,
      defaultShiftId: input.defaultShiftId,
      scheduleType,
      workPatternId: scheduleType === "FIXED" ? (input.workPatternId ?? null) : null,
      jobTitleId: input.jobTitleId ?? null,
      specialtyId: input.specialtyId ?? null,
      passwordHash: opts.passwordHash ?? (await bcrypt.hash(input.password ?? tempPassword!, 10)),
      mustChangePassword: true,
    },
  });
  await snapshotAssignment(e.id, BASELINE_DATE, db);
  await db.auditLog.create({
    data: { actorId, action: "EMPLOYEE_CREATE", entity: "Employee", entityId: String(e.id), detail: JSON.stringify({ code: e.code, role: e.role, ...(via ? { via } : {}) }) },
  });
  return { employee: e, tempPassword };
}
