/**
 * Seed dữ liệu mẫu (PRD mục 3). Chạy lại nhiều lần được: xóa sạch dữ liệu nghiệp vụ rồi tạo lại.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "../src/lib/attendance";
import { recordScan } from "../src/lib/attendance-service";
import { DEFAULT_APP_SETTINGS } from "../src/lib/settings";
import { randomDigits } from "../src/lib/crypto";
import { ensureDefaultPermissions } from "../src/lib/permissions";

const prisma = new PrismaClient();

// PRNG cố định để dữ liệu seed ổn định giữa các lần chạy trong cùng ngày.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function wipe() {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.attendanceLog.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.workSchedule.deleteMany(),
    prisma.faceTemplate.deleteMany(),
    prisma.zaloLinkCode.deleteMany(),
    prisma.kioskDevice.deleteMany(),
    prisma.department.updateMany({ data: { managerId: null } }),
    prisma.employee.deleteMany(),
    prisma.department.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.holiday.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.appSetting.deleteMany(),
    prisma.rolePermission.deleteMany(),
  ]);
}

async function main() {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await wipe();
  const rand = rng(20260919);

  const [hc, sang, dem] = await Promise.all([
    prisma.shift.create({ data: { name: "Hành chính", startTime: "08:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5 } }),
    prisma.shift.create({ data: { name: "Sáng sớm", startTime: "07:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5 } }),
    prisma.shift.create({ data: { name: "Ca đêm", startTime: "22:00", endTime: "06:00", breakMinutes: 60, graceLateMinutes: 5 } }),
  ]);

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

  await prisma.holiday.createMany({
    data: [
      { date: "2026-09-02", name: "Quốc khánh" },
      { date: "2027-01-01", name: "Tết Dương lịch" },
    ],
  });

  await ensureDefaultPermissions();

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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
