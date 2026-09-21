/**
 * Seed dữ liệu mẫu (PRD mục 3). Chạy lại nhiều lần được: xóa sạch dữ liệu nghiệp vụ rồi tạo lại.
 *  - `--base` (npm run db:seed:base): chỉ tạo cấu hình nền còn thiếu (ca, mẫu tuần, ngày lễ, quyền, cấu hình), không xóa gì,
 *    không tạo nhân viên — dùng cho vận hành thật, sau đó tạo Quản trị bằng `npm run admin:create`.
 *  - Mặc định (demo): XÓA SẠCH rồi tạo dữ liệu mẫu; từ chối nếu DB đã có nhân viên hoặc ca, trừ khi có `--force`
 *    (npm run db:seed:force) hoặc SEED_FORCE=1.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "../src/lib/attendance";
import { recordScan } from "../src/lib/attendance-service";
import { DEFAULT_APP_SETTINGS } from "../src/lib/settings";
import { randomDigits } from "../src/lib/crypto";
import { ensureDefaultPermissions } from "../src/lib/permissions";
import { BASELINE_DATE, snapshotAssignment } from "../src/lib/schedule-assignments";
import { BASE_HOLIDAYS, BASE_JOB_TITLES, BASE_PATTERNS, BASE_SHIFTS, BASE_SPECIALTIES, LICENSED_JOB_TITLES, patternShiftIds, seedBase } from "../src/lib/bootstrap";

const prisma = new PrismaClient();
const args = process.argv.slice(2);

// PRNG cố định để dữ liệu seed ổn định giữa các lần chạy trong cùng ngày.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function wipe() {
  // Ảnh đại diện (v1.10.0) của nhân viên cũ: xóa cùng dữ liệu — nhưng CHỈ thư mục ảnh đi cùng DB đang seed:
  // có DATA_DIR thì dùng nó; không có thì chỉ khi đang seed DB mặc định data/facebeo.db. Seed DB khác (vd. test.db) mà thiếu DATA_DIR
  // thì KHÔNG xóa gì (v1.10.3 — trước đó bộ test xóa nhầm ảnh thật ở data/avatars).
  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const url = process.env.DATABASE_URL ?? "";
  const dir = process.env.DATA_DIR || (/(^|[/\\:])facebeo\.db$/.test(url.replace(/^file:/, "")) ? join(process.cwd(), "data") : null);
  if (dir) await rm(join(dir, "avatars"), { recursive: true, force: true });
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.attendanceLog.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.workSchedule.deleteMany(),
    prisma.rosterWeek.deleteMany(),
    prisma.scheduleAssignment.deleteMany(),
    prisma.departmentShiftWeight.deleteMany(),
    prisma.faceTemplate.deleteMany(),
    prisma.credential.deleteMany(),
    prisma.practiceLicense.deleteMany(),
    prisma.zaloLinkCode.deleteMany(),
    prisma.kioskDevice.deleteMany(),
    prisma.department.updateMany({ data: { managerId: null } }),
    prisma.employee.deleteMany(),
    prisma.jobTitle.deleteMany(),
    prisma.specialty.deleteMany(),
    prisma.department.deleteMany(),
    prisma.workPattern.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.holiday.deleteMany(),
    prisma.infoLink.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.appSetting.deleteMany(),
    prisma.rolePermission.deleteMany(),
  ]);
}

async function base() {
  // Server có thể đang chạy: chờ khóa ghi thay vì lỗi SQLITE_BUSY ngay.
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  const r = await seedBase(prisma);
  const line = (label: string, c: { created: number; existing: number }) => `  ${label}: tạo mới ${c.created}, đã có ${c.existing}`;
  console.log("\n✅ Đã tạo cấu hình nền (không xóa dữ liệu, không tạo nhân viên):");
  console.log([line("Ca làm việc", r.shifts), line("Mẫu tuần", r.patterns), line("Ngày lễ", r.holidays), line("Cấu hình", r.settings), line("Chức danh", r.jobTitles), line("Chuyên khoa", r.specialties)].join("\n"));
  console.log(`  Ma trận quyền: ${r.permissionsInitialized ? "đã nạp mặc định" : "đã có, giữ nguyên"}`);
  console.log('\nBước tiếp theo: npm run admin:create -- --code AD01 --name "Họ Tên" --phone 09xxxxxxxx\n');
}

async function main() {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  const [employees, shifts] = await Promise.all([prisma.employee.count(), prisma.shift.count()]);
  if (employees + shifts > 0 && !args.includes("--force") && process.env.SEED_FORCE !== "1") {
    console.error(
      `\n⛔ DB đang có ${employees} nhân viên, ${shifts} ca. Seed demo sẽ XÓA SẠCH toàn bộ dữ liệu rồi tạo dữ liệu mẫu nên đã dừng.\n` +
        "   Chỉ cần cấu hình nền (ca, mẫu tuần, ngày lễ): npm run db:seed:base\n" +
        "   Chắc chắn muốn xóa sạch để tạo dữ liệu mẫu: npm run db:seed:force\n",
    );
    process.exitCode = 1;
    return;
  }
  await wipe();
  const rand = rng(20260919);

  // Ca demo giữ hệ số công mặc định 1 (dữ liệu test ổn định); ca nền thật dùng hệ số trong BASE_SHIFTS.
  const [hc, sang, dem, satAm] = await Promise.all(BASE_SHIFTS.map((s) => prisma.shift.create({ data: { ...s, workDayValue: 1 } })));
  const shiftId = new Map([hc, sang, dem, satAm].map((s) => [s.name, s.id]));

  // Mẫu tuần làm việc cho nhóm ca cố định (~70%).
  const [patHalfSat, patFullSat, patEarly] = await Promise.all(
    BASE_PATTERNS.map((p) => prisma.workPattern.create({ data: { name: p.name, ...patternShiftIds(shiftId.get(p.weekday)!, p.saturday ? shiftId.get(p.saturday)! : null) } })),
  );

  // Danh mục chức danh / chuyên khoa (v1.7.0): dữ liệu demo không gán cho nhân viên mẫu (giữ nguyên các test cũ).
  await prisma.jobTitle.createMany({ data: BASE_JOB_TITLES.map((name, i) => ({ name, sortOrder: i, requiresLicense: LICENSED_JOB_TITLES.has(name) })) });
  await prisma.specialty.createMany({ data: BASE_SPECIALTIES.map((name, i) => ({ name, sortOrder: i })) });

  const deptNames = ["Hành chính", "Kinh doanh", "Kỹ thuật", "Kho vận", "Chăm sóc khách hàng"];
  const depts: { id: number; name: string }[] = [];
  for (const name of deptNames) depts.push(await prisma.department.create({ data: { name } }));

  const passwordHash = await bcrypt.hash("123456", 10);
  type Seed = { name: string; role: string; dept: number; shift: number; rotating?: boolean };
  const people: Seed[] = [
    { name: "Nguyễn Văn An", role: "ADMIN", dept: 0, shift: hc.id },
    { name: "Trần Thị Bích", role: "MANAGER", dept: 0, shift: hc.id },
    { name: "Lê Hoàng Cường", role: "MANAGER", dept: 1, shift: hc.id },
    { name: "Phạm Minh Dũng", role: "MANAGER", dept: 2, shift: sang.id },
    { name: "Hoàng Thu Hà", role: "MANAGER", dept: 3, shift: sang.id },
    { name: "Vũ Đức Hải", role: "MANAGER", dept: 4, shift: hc.id },
    { name: "Đặng Thị Lan", role: "EMPLOYEE", dept: 0, shift: hc.id },
    { name: "Bùi Quang Minh", role: "EMPLOYEE", dept: 1, shift: hc.id },
    { name: "Đỗ Ngọc Nhi", role: "EMPLOYEE", dept: 2, shift: sang.id },
    { name: "Ngô Văn Phúc", role: "EMPLOYEE", dept: 3, shift: sang.id, rotating: true },
    { name: "Dương Thị Quỳnh", role: "EMPLOYEE", dept: 3, shift: sang.id, rotating: true },
    { name: "Lý Minh Sơn", role: "EMPLOYEE", dept: 2, shift: hc.id, rotating: true },
    { name: "Mai Anh Tuấn", role: "EMPLOYEE", dept: 4, shift: hc.id, rotating: true },
    { name: "Trịnh Thảo Vy", role: "EMPLOYEE", dept: 4, shift: hc.id, rotating: true },
    { name: "Phan Gia Huy", role: "EMPLOYEE", dept: 1, shift: hc.id, rotating: true },
    { name: "Lê Thị Nhân Sự", role: "HR", dept: 0, shift: hc.id },
  ];
  const emps = [];
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const e = await prisma.employee.create({
      data: {
        code: `NV${String(i + 1).padStart(3, "0")}`,
        name: p.name,
        phone: `09010000${String(i + 1).padStart(2, "0")}`,
        passwordHash,
        mustChangePassword: true,
        role: p.role,
        departmentId: depts[p.dept].id,
        defaultShiftId: p.shift,
        scheduleType: p.rotating ? "ROTATING" : "FIXED",
        workPatternId: p.rotating ? null : p.shift === sang.id ? patEarly.id : i % 2 === 0 ? patHalfSat.id : patFullSat.id,
      },
    });
    emps.push({ ...e, rotating: !!p.rotating });
    if (p.role === "MANAGER") await prisma.department.update({ where: { id: depts[p.dept].id }, data: { managerId: e.id } });
  }
  // Phòng Hành chính: quản lý là NV002 (đã gán ở trên); ADMIN NV001 cũng thuộc phòng này.

  // Lịch xoay ca tuần này và tuần sau cho 6 người (40%).
  const today = todayVN();
  const monday = startOfWeek(today);
  const pattern = [sang.id, hc.id, dem.id, null];
  const rotating = emps.filter((e) => e.rotating);
  for (let r = 0; r < rotating.length; r++) {
    for (let d = 0; d < 14; d++) {
      const date = addDays(monday, d);
      const slot = pattern[(r + Math.floor(d / 2)) % pattern.length];
      const isDayOff = slot === null || (weekday(date) === 7 && r % 2 === 0);
      await prisma.workSchedule.create({
        data: { employeeId: rotating[r].id, date, shiftId: isDayOff ? null : slot, isDayOff },
      });
    }
  }
  // Đăng ký sẵn ca tuần này và tuần sau cho các phòng có nhân viên xoay ca (lịch nháp không được tính công).
  for (const deptId of new Set(rotating.map((e) => e.departmentId))) {
    for (const ws of [monday, addDays(monday, 7)]) {
      await prisma.rosterWeek.create({ data: { departmentId: deptId, weekStart: ws, status: "REGISTERED", registeredById: emps[0].id, registeredAt: new Date() } });
    }
  }

  // Lịch sử phân công gốc (áp dụng cho mọi ngày) theo cấu hình hiện tại của từng nhân viên.
  for (const e of await prisma.employee.findMany({ select: { id: true } })) await snapshotAssignment(e.id, BASELINE_DATE);

  await prisma.holiday.createMany({ data: BASE_HOLIDAYS });

  await ensureDefaultPermissions();

  // Mục "Thông tin" (trang cá nhân): 2 liên kết mẫu toàn công ty + 1 liên kết chỉ Quản lý phòng Kinh doanh thấy.
  await prisma.infoLink.createMany({
    data: [
      { title: "Cẩm nang sử dụng Face Beo", url: "https://claude.ai/artifact/EiMsP9AtirhXTiNUeKyPXz", description: "Hướng dẫn mọi vai trò", icon: "book", color: "brand", order: 1 },
      { title: "Lịch họp công ty", url: "https://calendar.google.com/", description: "Google Calendar", icon: "calendar", color: "emerald", order: 2 },
      { title: "Bảng KPI Kinh doanh", url: "https://docs.google.com/spreadsheets/", description: "Chỉ quản lý phòng Kinh doanh", icon: "table", color: "amber", order: 3, visibleRoles: JSON.stringify(["MANAGER", "HR", "ADMIN"]), visibleDeptIds: JSON.stringify([depts[1].id]) },
    ],
  });

  for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
    await prisma.appSetting.create({ data: { key, value: String(value) } });
  }

  // 3 đơn mẫu: mỗi trạng thái một đơn.
  const lan = emps[6];
  const minh = emps[7];
  const nhi = emps[8];
  const nextWork = (() => {
    let d = addDays(today, 1);
    while (weekday(d) >= 6) d = addDays(d, 1);
    return d;
  })();
  await prisma.leaveRequest.create({
    data: {
      employeeId: lan.id,
      type: "NGHI_PHEP",
      fromTime: vnDateTime(nextWork, "08:00"),
      toTime: vnDateTime(nextWork, "17:00"),
      reason: "Đưa con đi khám bệnh định kỳ",
      status: "PENDING",
    },
  });
  const pastWork = (() => {
    let d = addDays(today, -1);
    while (weekday(d) === 7) d = addDays(d, -1);
    return d;
  })();
  await prisma.leaveRequest.create({
    data: {
      employeeId: minh.id,
      type: "VE_SOM",
      fromTime: vnDateTime(pastWork, "15:30"),
      toTime: vnDateTime(pastWork, "17:00"),
      reason: "Về sớm làm thủ tục ngân hàng",
      status: "APPROVED",
      approverId: emps[2].id,
      decidedAt: new Date(),
      decisionNote: "Đồng ý",
    },
  });
  await prisma.leaveRequest.create({
    data: {
      employeeId: nhi.id,
      type: "TANG_CA_OT",
      fromTime: vnDateTime(pastWork, "17:00"),
      toTime: vnDateTime(pastWork, "20:00"),
      reason: "Tăng ca hoàn thiện báo cáo kỹ thuật",
      status: "REJECTED",
      approverId: emps[3].id,
      decidedAt: new Date(),
      decisionNote: "Chưa cần tăng ca tuần này",
    },
  });

  // Kiosk mẫu kèm mã ghép.
  const pairCode = randomDigits(6);
  await prisma.kioskDevice.create({
    data: { name: "Kiosk sảnh chính", location: "Tầng 1 — cửa ra vào", pairCode, pairExpiresAt: new Date(Date.now() + 10 * 60_000) },
  });

  // Log MANUAL cho 5 ngày làm việc gần nhất (nhân viên ca cố định) để dashboard/Excel có dữ liệu.
  const fixed = emps.filter((e) => !e.rotating);
  const days: string[] = [];
  for (let d = addDays(today, -1); days.length < 5; d = addDays(d, -1)) if (weekday(d) !== 7) days.push(d);
  let logCount = 0;
  for (const d of days) {
    for (const e of fixed) {
      if (rand() < 0.08) continue; // thỉnh thoảng vắng
      const start = e.defaultShiftId === sang.id ? "07:00" : "08:00";
      const lateBy = rand() < 0.25 ? 6 + Math.floor(rand() * 20) : -Math.floor(rand() * 10);
      const inAt = new Date(vnDateTime(d, start).getTime() + lateBy * 60_000);
      const outAt = new Date(vnDateTime(d, "17:00").getTime() + Math.floor(rand() * 40 - 12) * 60_000);
      for (const t of [inAt, outAt]) {
        await recordScan({ employeeId: e.id, checkTime: t, source: "MANUAL", note: "Dữ liệu mẫu", createdById: emps[0].id });
        logCount++;
      }
    }
  }

  console.log("\n✅ Seed xong. Tài khoản (mật khẩu mặc định 123456, bắt buộc đổi ở lần đăng nhập đầu):");
  console.table(
    emps.map((e) => ({
      "Mã NV": e.code,
      "Họ tên": e.name,
      "Vai trò": e.role,
      "SĐT": e.phone,
      "Phòng": depts.find((d) => d.id === e.departmentId)!.name,
      "Xoay ca": e.rotating ? "✓" : "",
    })),
  );
  console.log(`Kiosk mẫu "Kiosk sảnh chính" — mã ghép: ${pairCode} (hết hạn sau 10 phút; tạo mã mới tại /admin/devices)`);
  console.log(`Đã tạo ${logCount} log chấm công MANUAL cho ${days.length} ngày gần nhất.\n`);
}

(args.includes("--base") ? base() : main())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
