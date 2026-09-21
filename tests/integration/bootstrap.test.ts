// Khởi tạo vận hành thật: seed cấu hình nền, tạo Quản trị đầu tiên, cấp lại mật khẩu, chặn seed demo trên DB có dữ liệu.
// Dùng DB riêng (data/test-bootstrap.db) tạo mới mỗi lần chạy — không đụng data/test.db của các test khác.
import { execSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_SHIFTS, BootstrapError, createFirstAdmin, resetAdminPassword, seedBase } from "@/lib/bootstrap";

const URL = "file:../data/test-bootstrap.db";
const env = { ...process.env, DATABASE_URL: URL, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
let db: PrismaClient;

beforeAll(() => {
  for (const ext of ["", "-wal", "-shm", "-journal"]) rmSync(join(process.cwd(), "data", `test-bootstrap.db${ext}`), { force: true });
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  db = new PrismaClient({ datasourceUrl: URL });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

const input = { code: "ad01", name: "Quản Trị Thật", phone: "0912345678" };

describe("bootstrap — DB trống", () => {
  it("chưa có ca → tạo Quản trị báo chạy db:seed:base trước", async () => {
    await expect(createFirstAdmin(db, input)).rejects.toThrow(/db:seed:base/);
    expect(await db.employee.count()).toBe(0);
  });

  it("seedBase tạo cấu hình nền, chạy lại không nhân đôi, không tạo nhân viên/phòng ban", async () => {
    const first = await seedBase(db);
    expect(first.shifts).toEqual({ created: 4, existing: 0 });
    expect(first.patterns.created).toBe(3);
    expect(first.permissionsInitialized).toBe(true);
    const second = await seedBase(db);
    expect(second.shifts).toEqual({ created: 0, existing: 4 });
    expect(second.patterns).toEqual({ created: 0, existing: 3 });
    expect(second.holidays.created).toBe(0);
    expect(second.settings.created).toBe(0);
    expect(second.permissionsInitialized).toBe(false);
    expect(await db.shift.count()).toBe(4);
    expect(await db.employee.count()).toBe(0);
    expect(await db.department.count()).toBe(0);
    // Ca nửa ngày tính 0.5 công.
    expect((await db.shift.findUniqueOrThrow({ where: { name: "Sáng thứ Bảy" } })).workDayValue).toBe(0.5);
    // Quản trị xóa một ca / một chức danh rồi chạy lại seed nền: không bị tạo lại (v1.7.0).
    await db.shift.delete({ where: { name: "Ca đêm" } });
    await db.jobTitle.delete({ where: { name: "IT" } });
    const third = await seedBase(db);
    expect(third.shifts).toEqual({ created: 0, existing: 3 });
    expect(third.jobTitles.created).toBe(0);
    expect(await db.shift.findUnique({ where: { name: "Ca đêm" } })).toBeNull();
    expect(await db.jobTitle.findUnique({ where: { name: "IT" } })).toBeNull();
    expect(first.jobTitles.created).toBe(12);
    expect(first.specialties.created).toBe(12);
  });

  it("thông tin sai định dạng / mật khẩu yếu → lỗi, không tạo gì", async () => {
    await expect(createFirstAdmin(db, { ...input, phone: "12345" })).rejects.toBeInstanceOf(BootstrapError);
    await expect(createFirstAdmin(db, { ...input, code: "a b" })).rejects.toBeInstanceOf(BootstrapError);
    await expect(createFirstAdmin(db, { ...input, password: "abcdefgh" })).rejects.toThrow(/Mật khẩu/);
    await expect(createFirstAdmin(db, { ...input, shift: "Không tồn tại" })).rejects.toThrow(/Không có ca/);
    expect(await db.employee.count()).toBe(0);
  });

  it("tạo Quản trị đầu tiên: ADMIN, phải đổi mật khẩu, có lịch sử phân công và nhật ký", async () => {
    const { employee, password } = await createFirstAdmin(db, input);
    expect(employee.code).toBe("AD01");
    expect(employee.role).toBe("ADMIN");
    expect(employee.mustChangePassword).toBe(true);
    expect(employee.departmentName).toBe("Ban quản trị");
    expect(employee.shiftName).toBe(BASE_SHIFTS[0].name);
    expect(password).toMatch(/^[A-Za-z]{6}\d{2}$/);
    const row = await db.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(await bcrypt.compare(password, row.passwordHash)).toBe(true);
    expect(await db.scheduleAssignment.count({ where: { employeeId: employee.id } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "EMPLOYEE_CREATE", entityId: String(employee.id) } });
    expect(log.actorId).toBeNull();
    expect(log.detail).not.toContain(password);
  });

  it("đã có Quản trị hoạt động → từ chối tạo thêm, gợi ý --reset", async () => {
    await expect(createFirstAdmin(db, { ...input, code: "AD02", phone: "0912345679" })).rejects.toThrow(/--reset AD01/);
    expect(await db.employee.count()).toBe(1);
  });

  it("cấp lại mật khẩu: mở khóa, tăng sessionVersion, bắt đổi mật khẩu", async () => {
    const before = await db.employee.update({
      where: { code: "AD01" },
      data: { mustChangePassword: false, failedLogins: 3, lockedUntil: new Date(Date.now() + 3_600_000) },
    });
    const { employee, password } = await resetAdminPassword(db, "ad01", "MatKhau2026");
    expect(password).toBe("MatKhau2026");
    expect(employee.sessionVersion).toBe(before.sessionVersion + 1);
    expect(employee.failedLogins).toBe(0);
    expect(employee.lockedUntil).toBeNull();
    expect(employee.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("MatKhau2026", employee.passwordHash)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "PASSWORD_RESET", entityId: String(employee.id) } })).toBe(1);
  });

  it("cấp lại mật khẩu: mã không tồn tại / không phải ADMIN / đã nghỉ việc → từ chối", async () => {
    await expect(resetAdminPassword(db, "KHONGCO")).rejects.toThrow(/Không có nhân viên/);
    const admin = await db.employee.findUniqueOrThrow({ where: { code: "AD01" } });
    await db.employee.create({
      data: { code: "NV900", name: "Nhân Viên", phone: "0912000900", passwordHash: "x", departmentId: admin.departmentId, defaultShiftId: admin.defaultShiftId },
    });
    await expect(resetAdminPassword(db, "NV900")).rejects.toThrow(/không phải Quản trị/);
    await db.employee.update({ where: { code: "AD01" }, data: { active: false } });
    await expect(resetAdminPassword(db, "AD01")).rejects.toThrow(/nghỉ việc/);
  });

  it("Quản trị cũ đã nghỉ việc → tạo được Quản trị mới; trùng mã/SĐT → lỗi", async () => {
    await expect(createFirstAdmin(db, { ...input, phone: "0912345670" })).rejects.toThrow(/AD01 đã tồn tại/);
    await expect(createFirstAdmin(db, { ...input, code: "AD02" })).rejects.toThrow(/đã được dùng/);
    const { employee } = await createFirstAdmin(db, { code: "AD02", name: "Quản Trị Mới", phone: "0912345679", department: " Ban quản trị " });
    expect(employee.role).toBe("ADMIN");
    expect(await db.department.count()).toBe(1); // dùng lại phòng đã có
  });

  it("seed demo từ chối chạy trên DB đã có nhân viên khi thiếu --force", () => {
    const r = spawnSync("npx tsx prisma/seed.ts", { env: { ...env, SEED_FORCE: "" }, shell: true, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/db:seed:base/);
    return db.employee.count().then((n) => expect(n).toBe(3));
  }, 120_000);
});
