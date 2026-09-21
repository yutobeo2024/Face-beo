/**
 * Khởi tạo hệ thống cho vận hành thật (không kéo theo dữ liệu mẫu):
 *  - seedBase: cấu hình nền (ca, mẫu tuần, ngày lễ, quyền mặc định, cấu hình) — không xóa gì, không tạo nhân viên, chạy lại được.
 *  - createFirstAdmin: tạo tài khoản Quản trị đầu tiên khi DB chưa có ADMIN nào đang hoạt động.
 *  - resetAdminPassword: cấp lại mật khẩu tạm cho một ADMIN (khi quên mật khẩu / bị khóa).
 * Mọi hàm nhận `db` để chạy được trên DB bất kỳ (script CLI, test).
 */
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { prisma } from "./db";
import { ensureDefaultPermissions } from "./permissions";
import { DEFAULT_APP_SETTINGS } from "./settings";
import { BASELINE_DATE, snapshotAssignment } from "./schedule-assignments";
import { randomTempPassword } from "./temp-password";
import { changePasswordSchema, employeeCreateSchema } from "./validators";

type Db = typeof prisma;

/** Lỗi hiển thị thẳng cho người chạy lệnh (không kèm stack). */
export class BootstrapError extends Error {}

export type BaseShift = {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStart?: string;
  graceLateMinutes: number;
  workDayValue: number;
};

/** Ca nền. Ca nửa ngày (sáng thứ Bảy 4 giờ) tính 0.5 công; chỉnh lại được trong Cài đặt → Ca làm việc. */
export const BASE_SHIFTS: BaseShift[] = [
  { name: "Hành chính", startTime: "08:00", endTime: "17:00", breakMinutes: 60, breakStart: "12:00", graceLateMinutes: 5, workDayValue: 1 },
  { name: "Sáng sớm", startTime: "07:00", endTime: "17:00", breakMinutes: 60, breakStart: "12:00", graceLateMinutes: 5, workDayValue: 1 },
  { name: "Ca đêm", startTime: "22:00", endTime: "06:00", breakMinutes: 60, graceLateMinutes: 5, workDayValue: 1 },
  { name: "Sáng thứ Bảy", startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 5, workDayValue: 0.5 },
];

/** Mẫu tuần nền: tên ca T2–T6 và ca thứ Bảy (Chủ nhật nghỉ). */
export const BASE_PATTERNS: { name: string; weekday: string; saturday: string | null }[] = [
  { name: "HC T2–T6 + T7 sáng", weekday: "Hành chính", saturday: "Sáng thứ Bảy" },
  { name: "HC T2–T7", weekday: "Hành chính", saturday: "Hành chính" },
  { name: "Sáng sớm T2–T7", weekday: "Sáng sớm", saturday: "Sáng sớm" },
];

export const BASE_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-09-02", name: "Quốc khánh" },
  { date: "2027-01-01", name: "Tết Dương lịch" },
];

export function patternShiftIds(weekdayId: number, saturdayId: number | null) {
  return { monShiftId: weekdayId, tueShiftId: weekdayId, wedShiftId: weekdayId, thuShiftId: weekdayId, friShiftId: weekdayId, satShiftId: saturdayId, sunShiftId: null };
}

type Count = { created: number; existing: number };

/** Tạo cấu hình nền còn thiếu (so theo tên ca / tên mẫu tuần / ngày lễ / khóa cấu hình). Không sửa bản ghi đã có. */
export async function seedBase(db: Db) {
  const result = { shifts: { created: 0, existing: 0 } as Count, patterns: { created: 0, existing: 0 } as Count, holidays: { created: 0, existing: 0 } as Count, settings: { created: 0, existing: 0 } as Count, permissionsInitialized: false };

  const shiftIds = new Map<string, number>();
  for (const s of BASE_SHIFTS) {
    const found = await db.shift.findUnique({ where: { name: s.name } });
    if (found) {
      shiftIds.set(s.name, found.id);
      result.shifts.existing++;
    } else {
      shiftIds.set(s.name, (await db.shift.create({ data: s })).id);
      result.shifts.created++;
    }
  }

  for (const p of BASE_PATTERNS) {
    if (await db.workPattern.findUnique({ where: { name: p.name } })) {
      result.patterns.existing++;
      continue;
    }
    await db.workPattern.create({ data: { name: p.name, ...patternShiftIds(shiftIds.get(p.weekday)!, p.saturday ? shiftIds.get(p.saturday)! : null) } });
    result.patterns.created++;
  }

  for (const h of BASE_HOLIDAYS) {
    if (await db.holiday.findUnique({ where: { date: h.date } })) result.holidays.existing++;
    else {
      await db.holiday.create({ data: h });
      result.holidays.created++;
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
    if (await db.appSetting.findUnique({ where: { key } })) result.settings.existing++;
    else {
      await db.appSetting.create({ data: { key, value: String(value) } });
      result.settings.created++;
    }
  }

  result.permissionsInitialized = await ensureDefaultPermissions(db);
  return result;
}

export const DEFAULT_ADMIN_DEPARTMENT = "Ban quản trị";

export type FirstAdminInput = {
  code: string;
  name: string;
  phone: string;
  /** Tên phòng ban; chưa có thì tạo mới. */
  department?: string;
  /** Tên ca mặc định; bỏ trống = "Hành chính", không có thì lấy ca đầu tiên. */
  shift?: string;
  /** Mật khẩu tự đặt (≥ 8 ký tự, có chữ và số); bỏ trống = sinh mật khẩu tạm. */
  password?: string;
};

const FIELD_LABELS: Record<string, string> = { code: "mã NV", name: "họ tên", phone: "SĐT" };

function zodMessage(e: { issues: { path: PropertyKey[]; message: string }[] }) {
  return e.issues.map((i) => `${FIELD_LABELS[String(i.path[0])] ?? String(i.path[0])}: ${i.message}`).join("; ");
}

function checkPassword(password: string | undefined) {
  if (password === undefined) return randomTempPassword();
  const parsed = changePasswordSchema.shape.newPassword.safeParse(password);
  if (!parsed.success) throw new BootstrapError(`Mật khẩu không hợp lệ — ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return password;
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Tạo ADMIN đầu tiên. Trả về tài khoản và mật khẩu (để in một lần ra màn hình). */
export async function createFirstAdmin(db: Db, input: FirstAdminInput) {
  const parsed = employeeCreateSchema
    .pick({ code: true, phone: true })
    .extend({ name: z.string().trim().min(2, "tối thiểu 2 ký tự").max(100, "tối đa 100 ký tự") })
    .safeParse(input);
  if (!parsed.success) throw new BootstrapError(`Thông tin không hợp lệ — ${zodMessage(parsed.error)}`);
  const code = parsed.data.code.toUpperCase();
  const { name, phone } = parsed.data;
  const password = checkPassword(input.password);

  const assertNoActiveAdmin = async (q: Pick<Db, "employee">) => {
    const admin = await q.employee.findFirst({ where: { role: "ADMIN", active: true }, select: { code: true } });
    if (admin) throw new BootstrapError(`Đã có Quản trị đang hoạt động (mã ${admin.code}). Quên mật khẩu thì dùng: npm run admin:create -- --reset ${admin.code}`);
  };
  await assertNoActiveAdmin(db);

  const dup = await db.employee.findFirst({ where: { OR: [{ code }, { phone }] }, select: { code: true, phone: true } });
  if (dup) throw new BootstrapError(dup.code === code ? `Mã nhân viên ${code} đã tồn tại.` : `Số điện thoại ${phone} đã được dùng (mã ${dup.code}).`);

  const shiftName = input.shift?.trim();
  const shift = shiftName
    ? await db.shift.findUnique({ where: { name: shiftName } })
    : ((await db.shift.findUnique({ where: { name: BASE_SHIFTS[0].name } })) ?? (await db.shift.findFirst({ orderBy: { id: "asc" } })));
  if (!shift) {
    throw new BootstrapError(shiftName ? `Không có ca tên "${shiftName}".` : "Chưa có ca làm việc nào. Chạy trước: npm run db:seed:base");
  }

  const deptName = input.department?.trim() || DEFAULT_ADMIN_DEPARTMENT;
  if (deptName.length > 100) throw new BootstrapError("Tên phòng ban tối đa 100 ký tự.");
  const passwordHash = await bcrypt.hash(password, 10);

  const employee = await db.$transaction(async (tx) => {
    await assertNoActiveAdmin(tx); // kiểm lại trong giao dịch: hai lệnh chạy cùng lúc không tạo được hai Quản trị
    const dept = (await tx.department.findUnique({ where: { name: deptName } })) ?? (await tx.department.create({ data: { name: deptName } }));
    const e = await tx.employee.create({
      data: { code, name, phone, passwordHash, mustChangePassword: true, role: "ADMIN", departmentId: dept.id, defaultShiftId: shift.id, scheduleType: "FIXED" },
    });
    await snapshotAssignment(e.id, BASELINE_DATE, tx);
    await tx.auditLog.create({
      data: { actorId: null, action: "EMPLOYEE_CREATE", entity: "Employee", entityId: String(e.id), detail: JSON.stringify({ via: "cli", role: "ADMIN", code }) },
    });
    return { ...e, departmentName: dept.name, shiftName: shift.name };
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new BootstrapError(`Mã ${code} hoặc SĐT ${phone} vừa được dùng — chạy lại lệnh để xem chi tiết.`);
    throw e;
  });
  return { employee, password };
}

/** Cấp mật khẩu tạm mới cho một ADMIN đang hoạt động: mở khóa đăng nhập, thu hồi mọi phiên cũ. */
export async function resetAdminPassword(db: Db, rawCode: string, newPassword?: string) {
  const code = rawCode.trim().toUpperCase();
  const e = await db.employee.findUnique({ where: { code } });
  if (!e) throw new BootstrapError(`Không có nhân viên mã ${code}.`);
  if (e.role !== "ADMIN") throw new BootstrapError(`${code} không phải Quản trị — dùng trang Nhân viên để đặt lại mật khẩu.`);
  // Không kích hoạt lại người đã nghỉ việc: khi không còn Quản trị nào hoạt động thì tạo tài khoản mới bằng admin:create.
  if (!e.active) throw new BootstrapError(`${code} đã nghỉ việc. Tạo Quản trị mới: npm run admin:create -- --code … --name … --phone …`);
  const password = checkPassword(newPassword);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.employee.update({
      where: { id: e.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: { actorId: null, action: "PASSWORD_RESET", entity: "Employee", entityId: String(e.id), detail: JSON.stringify({ via: "cli" }) },
    });
    return u;
  });
  return { employee: updated, password };
}
