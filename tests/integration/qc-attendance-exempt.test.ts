// QC v1.12.0 "Không chấm công": kiểm thử đối kháng ngoài bộ test chính (attendance-exempt.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { TZ, addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { absenceCheck, missingCheckout, rosterReminder, rosterReport } from "@/lib/jobs";
import { buildAttendanceReport } from "@/lib/reports";
import { createEmployee } from "@/lib/employees";
import { IMPORT_COLUMNS } from "@/lib/employee-import";
import { invalidatePermissionCache } from "@/lib/permissions";
import { invalidatePayrollLockCache } from "@/lib/payroll-lock-state";
import { BASE, byCode, ctx, enrollFake, pairedDevice, req, scanPayload, sessionCookie } from "./helpers";

import * as deptRoute from "@/app/api/departments/[id]/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as meRoute from "@/app/api/me/overview/route";
import * as xlsxRoute from "@/app/api/reports/attendance.xlsx/route";
import * as inoutRoute from "@/app/api/reports/inout.xlsx/route";
import * as rosterRoute from "@/app/api/roster/route";
import * as scanRoute from "@/app/api/kiosk/scan/route";
import * as importRoute from "@/app/api/employees/import/route";
import * as locksRoute from "@/app/api/payroll-locks/route";
import * as unlockRoute from "@/app/api/payroll-locks/[month]/route";

const tag = `Q${Date.now().toString().slice(-5)}`;
const G_CC = `qcx-cc-${tag}`;
const G_MB = `qcx-mb-${tag}`;
const monday = addDays(startOfWeek(todayVN()), 14); // thứ Hai 2 tuần sau
const D1 = addDays(monday, 1); // absenceCheck
const D2 = addDays(monday, 2); // missingCheckout
const D3 = addDays(monday, 3); // bật lại
const MONTH = DateTime.fromISO(todayVN(), { zone: TZ }).startOf("month").minus({ months: 7 }).toFormat("yyyy-MM");
const FAR_FRI = "2031-01-03"; // thứ Sáu
const FAR_MON = "2031-01-06";

let deptN = 0, deptEx = 0, deptRotEx = 0, deptRotOk = 0;
let T = 0, P = 0, B = 0, K = 0, R1 = 0, R2 = 0, HRX = 0, MX = 0;
let hcId = 0;
let A: string, H: string, M: string;
let mgrDept = 0;
const deviceIds: number[] = [];
let lockedByMe = false;
const ids = () => [T, P, B, K, R1, R2, HRX, MX].filter(Boolean);
const code = (s: string) => `${tag}${s}`;
const frames = (v: number) => Array.from({ length: 5 }, () => ({ real: v, live: v }));
const cnt = (key: string) => prisma.notificationLog.count({ where: { dedupeKey: key } });
const patchEmp = (cookie: string, id: number, body: unknown) => employeeRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
const patchDept = (cookie: string, id: number, body: unknown) => deptRoute.PATCH(req(`/api/departments/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
const flag = async (id: number) => (await prisma.employee.findUniqueOrThrow({ where: { id } })).attendanceExempt;

beforeAll(async () => {
  const [admin, hr, mgr] = await Promise.all(["NV001", "NV016", "NV003"].map(byCode));
  [A, H, M] = await Promise.all([admin.id, hr.id, mgr.id].map(sessionCookie));
  mgrDept = mgr.departmentId;
  const hc = await prisma.shift.findFirstOrThrow({ where: { name: "Hành chính" } });
  hcId = hc.id;
  const pattern = await prisma.workPattern.findFirstOrThrow({ where: { monShiftId: hc.id } });
  const mkDept = async (name: string) => (await prisma.department.create({ data: { name: `${name} ${tag}` } })).id;
  [deptN, deptEx, deptRotEx, deptRotOk] = [await mkDept("QC thường"), await mkDept("QC BGĐ"), await mkDept("QC xoay miễn"), await mkDept("QC xoay thường")];
  const mk = async (c: string, departmentId: number, extra: Record<string, unknown> = {}) =>
    (await createEmployee({ code: code(c), name: `QC ${c}`, role: "EMPLOYEE", departmentId, defaultShiftId: hc.id, scheduleType: "FIXED", workPatternId: pattern.id, ...extra } as never, null)).employee.id;
  T = await mk("T", deptN);
  P = await mk("P", deptN);
  B = await mk("B", deptEx);
  K = await mk("K", deptEx);
  R1 = await mk("R", deptRotEx, { scheduleType: "ROTATING", workPatternId: null });
  R2 = await mk("S", deptRotOk, { scheduleType: "ROTATING", workPatternId: null });
  HRX = await mk("H", deptN, { role: "HR" });
  MX = await mk("M", mgrDept);
  for (const [i, id] of [T, P, B, K].entries()) await enrollFake(id, 7700 + i);
  await prisma.zaloGroup.createMany({
    data: [
      { groupId: G_CC, name: "QC chấm công", source: "MANUAL", categories: JSON.stringify(["CHAM_CONG"]) },
      { groupId: G_MB, name: "QC minh bạch", source: "MANUAL", categories: JSON.stringify(["MINH_BACH"]) },
    ],
  });
  expect((await patchDept(A, deptEx, { attendanceExempt: true })).status).toBe(200);
  expect((await patchEmp(A, K, { attendanceExempt: false })).status).toBe(200);
  expect((await patchEmp(A, P, { attendanceExempt: true })).status).toBe(200);
  expect((await patchEmp(A, R1, { attendanceExempt: true })).status).toBe(200);
});

afterAll(async () => {
  scanPayload(null);
  if (lockedByMe) {
    await prisma.lockedDay.deleteMany({ where: { month: MONTH } });
    await prisma.payrollLock.deleteMany({ where: { month: MONTH } });
    invalidatePayrollLockCache();
  }
  await prisma.rolePermission.deleteMany({ where: { role: "MANAGER", capability: { in: ["org.manage", "employees.manage"] } } });
  invalidatePermissionCache();
  const imported = (await prisma.employee.findMany({ where: { code: { startsWith: tag } }, select: { id: true } })).map((e) => e.id);
  const all = [...new Set([...ids(), ...imported])];
  const depts = [deptN, deptEx, deptRotEx, deptRotOk];
  await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: all } } });
  await prisma.faceTemplate.deleteMany({ where: { employeeId: { in: all } } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: all } } });
  await prisma.workSchedule.deleteMany({ where: { employeeId: { in: all } } });
  await prisma.notificationLog.deleteMany({ where: { toEmployeeId: { in: all } } });
  await prisma.notificationLog.deleteMany({ where: { toGroupId: { in: [G_CC, G_MB] } } });
  await prisma.notificationLog.deleteMany({ where: { OR: depts.map((d) => ({ dedupeKey: { startsWith: `absent-digest:${d}:` } })) } });
  await prisma.notificationLog.deleteMany({ where: { OR: [{ dedupeKey: { contains: addDays(FAR_FRI, 3) } }, { dedupeKey: { contains: FAR_MON } }] } });
  await prisma.auditLog.deleteMany({ where: { entity: "AttendanceDay", OR: all.map((id) => ({ entityId: { startsWith: `${id}|` } })) } });
  await prisma.kioskDevice.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.zaloGroup.deleteMany({ where: { groupId: { in: [G_CC, G_MB] } } });
  await prisma.employee.deleteMany({ where: { id: { in: all } } });
  await prisma.department.deleteMany({ where: { id: { in: depts } } });
});

describe("cảnh báo & tin nhóm CHAM_CONG", () => {
  it("absenceCheck: không nhắc riêng, không tin nhóm CHAM_CONG, không có trong ABSENT_DIGEST cho người miễn", async () => {
    await absenceCheck(vnDateTime(D1, "10:00"));
    expect(await cnt(`absent:${T}:${D1}`)).toBe(1);
    expect(await cnt(`absent:${K}:${D1}`)).toBe(1);
    expect(await cnt(`absent:${P}:${D1}`)).toBe(0);
    expect(await cnt(`absent:${B}:${D1}`)).toBe(0);
    expect(await cnt(`staff:absent:${T}:${D1}@${G_CC}`)).toBe(1);
    expect(await cnt(`staff:absent:${P}:${D1}@${G_CC}`)).toBe(0);
    expect(await cnt(`staff:absent:${B}:${D1}@${G_CC}`)).toBe(0);
    const digN = await prisma.notificationLog.findMany({ where: { messageType: "ABSENT_DIGEST", dedupeKey: { startsWith: `absent-digest:${deptN}:${D1}:` } } });
    expect(digN.length).toBeGreaterThan(0);
    for (const r of digN) {
      expect(r.payload).toContain(code("T"));
      expect(r.payload).not.toContain(code("P"));
    }
    const digEx = await prisma.notificationLog.findMany({ where: { messageType: "ABSENT_DIGEST", dedupeKey: { startsWith: `absent-digest:${deptEx}:${D1}:` } } });
    expect(digEx.length).toBeGreaterThan(0);
    for (const r of digEx) {
      expect(r.payload).toContain(code("K"));
      expect(r.payload).not.toContain(code("B"));
    }
  });

  it("vắng không phép cuối ngày (absent-final): không báo nhóm cho người miễn", async () => {
    await absenceCheck(vnDateTime(D1, "20:00"));
    expect(await cnt(`staff:absent-final:${T}:${D1}@${G_CC}`)).toBe(1);
    expect(await cnt(`staff:absent-final:${P}:${D1}@${G_CC}`)).toBe(0);
    expect(await cnt(`staff:absent-final:${B}:${D1}@${G_CC}`)).toBe(0);
  });

  it("missingCheckout: không tin nhóm CHAM_CONG cho người miễn lỡ quét vào", async () => {
    for (const id of [T, P, B]) await recordScan({ employeeId: id, checkTime: vnDateTime(D2, "07:58"), source: "KIOSK" });
    await missingCheckout(vnDateTime(D2, "23:00"));
    expect(await cnt(`staff:missing-out:${T}|${D2}@${G_CC}`)).toBe(1);
    expect(await cnt(`staff:missing-out:${P}|${D2}@${G_CC}`)).toBe(0);
    expect(await cnt(`staff:missing-out:${B}|${D2}@${G_CC}`)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "MISSING_CHECKOUT", entityId: `${P}|${D2}` } })).toBe(0);
  });

  it("quét kiosk thật của người miễn vẫn ghi log", async () => {
    const base = await enrollFake(P, 7701);
    const { device, cookie } = await pairedDevice(`QC kiosk ${tag}`);
    deviceIds.push(device.id);
    const clientEventId = randomUUID();
    const body = { ...scanPayload(base), frames: frames(0.95), clientEventId, capturedAt: new Date().toISOString() };
    const r = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).json();
    scanPayload(null);
    expect(r.result).toBe("OK");
    expect(r.employee.code).toBe(code("P"));
    expect(await prisma.attendanceLog.count({ where: { clientEventId, employeeId: P } })).toBe(1);
    // không nhắc trễ / không báo trễ-sớm trên kiosk cho người miễn (dù giờ quét có trễ hay không)
    expect(r.isLate).toBe(false);
    expect(r.lateMinutes).toBe(0);
    expect(r.isEarly).toBe(false);
    await new Promise((res) => setTimeout(res, 300)); // notifyLateIfNeeded chạy "void"
    expect(await prisma.notificationLog.count({ where: { toEmployeeId: P, messageType: "LATE_REMINDER" } })).toBe(0);
  });
});

describe("xếp ca xoay", () => {
  it("rosterReminder/rosterReport không tính phòng chỉ có người xoay ca đã miễn", async () => {
    await rosterReminder(vnDateTime(FAR_FRI, "15:00"));
    const week = addDays(startOfWeek(FAR_FRI), 7);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `roster-remind:${deptRotOk}:${week}:` } } })).toBeGreaterThan(0);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `roster-remind:${deptRotEx}:${week}:` } } })).toBe(0);
    await rosterReport(vnDateTime(FAR_MON, "07:00"));
    const rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { contains: `roster-unreg:${FAR_MON}` } } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.payload).toContain(`QC xoay thường ${tag}`);
      expect(r.payload).not.toContain(`QC xoay miễn ${tag}`);
    }
  });

  it("Xếp ca nhóm xoay ca không hiện người xoay ca đã miễn", async () => {
    const j = JSON.stringify(await (await rosterRoute.GET(req(`/api/roster?week=${monday}&group=rotating`, { cookie: A }), ctx())).json());
    expect(j).toContain(code("S"));
    expect(j).not.toContain(code("R"));
  });
});

describe("Excel", () => {
  const sheetText = async (res: Response) => {
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const cells: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => void cells.push(String(c.text ?? "")))));
    return `|${cells.join("|")}|`;
  };
  it("attendance.xlsx và inout.xlsx không có người miễn", async () => {
    for (const dept of [deptN, deptEx]) {
      const q = `from=${D1}&to=${D2}&departmentId=${dept}`;
      const a = await sheetText(await xlsxRoute.GET(req(`/api/reports/attendance.xlsx?${q}`, { cookie: A }), ctx()));
      const b = await sheetText(await inoutRoute.GET(req(`/api/reports/inout.xlsx?${q}`, { cookie: A }), ctx()));
      for (const s of [a, b]) {
        // inout.xlsx chỉ có họ tên (không có mã) → so theo "|QC X|"
        expect(s).toContain(dept === deptN ? "|QC T|" : "|QC K|");
        expect(s).not.toContain("|QC P|");
        expect(s).not.toContain("|QC B|");
      }
    }
  });
});

describe("chốt công", () => {
  it("người miễn không có LockedDay; người đã chụp trong tháng chốt vẫn hiện sau khi chuyển sang miễn", async () => {
    if (await prisma.payrollLock.findUnique({ where: { month: MONTH } })) throw new Error(`Tháng ${MONTH} đã chốt sẵn trong test.db`);
    let day = `${MONTH}-10`;
    while (weekday(day) !== 2) day = addDays(day, 1);
    const admin = await byCode("NV001");
    for (const id of [T, P]) await recordScan({ employeeId: id, checkTime: vnDateTime(day, "07:58"), source: "MANUAL", createdById: admin.id });
    const res = await locksRoute.POST(req("/api/payroll-locks", { method: "POST", cookie: H, body: { month: MONTH } }), ctx());
    expect(res.status).toBe(200);
    lockedByMe = true;
    expect(await prisma.lockedDay.count({ where: { month: MONTH, employeeId: T } })).toBeGreaterThan(0);
    expect(await prisma.lockedDay.count({ where: { month: MONTH, employeeId: P } })).toBe(0);
    const { from, to } = { from: `${MONTH}-01`, to: DateTime.fromISO(`${MONTH}-01`).endOf("month").toISODate()! };
    expect((await buildAttendanceReport({ id: P }, from, to)).summary).toHaveLength(0);
    // T chuyển sang miễn sau khi chốt: bản chụp là lịch sử bất biến
    expect((await patchEmp(A, T, { attendanceExempt: true })).status).toBe(200);
    const rep = await buildAttendanceReport({}, from, to);
    const repIds = rep.summary.map((r: { employeeId?: number; id?: number }) => r.employeeId ?? r.id);
    expect(repIds).toContain(T);
    expect(repIds).not.toContain(P);
    expect((await patchEmp(A, T, { attendanceExempt: null })).status).toBe(200);
    const un = await unlockRoute.DELETE(req(`/api/payroll-locks/${MONTH}`, { method: "DELETE", cookie: A, body: { reason: "QC kiểm thử miễn chấm công" } }), ctx({ month: MONTH }));
    expect(un.status).toBe(200);
    lockedByMe = false;
    invalidatePayrollLockCache();
  });
});

describe("cấu hình theo phòng / theo người", () => {
  it("/api/me/overview trả attendanceExempt đúng", async () => {
    const me = async (id: number) => (await (await meRoute.GET(req("/api/me/overview", { cookie: await sessionCookie(id) }), ctx())).json()).me.attendanceExempt;
    expect(await me(P)).toBe(true);
    expect(await me(B)).toBe(true);
    expect(await me(K)).toBe(false);
    expect(await me(T)).toBe(false);
  });

  it("K 'vẫn chấm công' → null thì theo phòng (miễn); đặt lại false thì được chấm", async () => {
    const att = async (id: number) =>
      ((await (await employeesRoute.GET(req("/api/employees", { cookie: A }), ctx())).json()).employees as { id: number; attendance: unknown }[]).find((e) => e.id === id)!.attendance;
    expect(await att(K)).toEqual({ exempt: false, source: null });
    expect((await patchEmp(A, K, { attendanceExempt: null })).status).toBe(200);
    expect(await att(K)).toEqual({ exempt: true, source: "DEPARTMENT" });
    expect((await patchEmp(A, K, { attendanceExempt: false })).status).toBe(200);
    expect(await att(K)).toEqual({ exempt: false, source: null });
  });

  it("bật lại (người + phòng) → cảnh báo quay lại; mỗi lần đổi có tin nhóm minh bạch", async () => {
    expect((await patchEmp(A, P, { attendanceExempt: null })).status).toBe(200);
    expect((await patchDept(A, deptEx, { attendanceExempt: false })).status).toBe(200);
    await absenceCheck(vnDateTime(D3, "10:00"));
    expect(await cnt(`absent:${P}:${D3}`)).toBe(1);
    expect(await cnt(`absent:${B}:${D3}`)).toBe(1);
    expect(await cnt(`staff:absent:${P}:${D3}@${G_CC}`)).toBe(1);
    const mb = await prisma.notificationLog.findMany({ where: { toGroupId: G_MB } });
    const txt = mb.map((r) => r.payload).join("\n");
    expect(txt).toContain("theo phòng"); // P: null
    expect(txt).toContain("bật lại chấm công"); // phòng
    expect(mb.some((r) => r.dedupeKey.startsWith(`grp:emp-update:${P}:`))).toBe(true);
    // khôi phục
    expect((await patchEmp(A, P, { attendanceExempt: true })).status).toBe(200);
    expect((await patchDept(A, deptEx, { attendanceExempt: true })).status).toBe(200);
  });
});

describe("quyền", () => {
  it("HR gửi attendanceExempt khác hiện tại → 403; gửi đúng giá trị hiện tại (no-op) → 200", async () => {
    expect((await patchEmp(H, T, { attendanceExempt: true })).status).toBe(403);
    expect((await patchEmp(H, T, { attendanceExempt: false })).status).toBe(403);
    expect((await patchEmp(H, P, { attendanceExempt: null })).status).toBe(403);
    expect(await flag(T)).toBeNull();
    expect(await flag(P)).toBe(true);
    expect((await patchEmp(H, T, { attendanceExempt: null })).status).toBe(200);
    expect((await patchEmp(H, K, { attendanceExempt: false, name: "QC K" })).status).toBe(200);
    expect(await flag(K)).toBe(false);
  });

  it("Quản lý được cấp employees.manage + org.manage vẫn không đổi được cờ (người / phòng)", async () => {
    await prisma.rolePermission.createMany({ data: [{ role: "MANAGER", capability: "employees.manage" }, { role: "MANAGER", capability: "org.manage" }] });
    invalidatePermissionCache();
    try {
      const before = (await prisma.department.findUniqueOrThrow({ where: { id: mgrDept } })).attendanceExempt;
      const r1 = await patchEmp(M, MX, { attendanceExempt: true });
      expect(r1.status).toBe(403);
      expect(await flag(MX)).toBeNull();
      expect((await patchEmp(M, MX, { name: "QC M2" })).status).toBe(200); // quyền thật sự có hiệu lực
      const r2 = await patchDept(M, mgrDept, { attendanceExempt: !before });
      expect(r2.status).toBe(403);
      expect((await prisma.department.findUniqueOrThrow({ where: { id: mgrDept } })).attendanceExempt).toBe(before);
    } finally {
      await prisma.rolePermission.deleteMany({ where: { role: "MANAGER", capability: { in: ["org.manage", "employees.manage"] } } });
      invalidatePermissionCache();
    }
  });

  it("nhập Excel không đặt được cờ (cột lạ bị bỏ qua)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Nhân viên");
    ws.addRow([...IMPORT_COLUMNS.map((c) => c.header), "Không chấm công", "attendanceExempt"]);
    const row: Record<string, string> = { code: code("I"), name: "QC Nhập", department: `QC thường ${tag}` };
    ws.addRow([...IMPORT_COLUMNS.map((c) => row[c.key] ?? null), "x", "true"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await importRoute.POST(
      new NextRequest(new URL(`/api/employees/import?mode=commit&defaultShiftId=${hcId}&defaultPatternId=none`, BASE), {
        method: "POST",
        headers: { cookie: H, "content-type": "application/octet-stream" },
        body: new Uint8Array(buf),
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const e = await prisma.employee.findUniqueOrThrow({ where: { code: code("I") } });
    expect(e.attendanceExempt).toBeNull();
  });

  it("Nhân sự / nhập Excel chuyển-tạo người vào phòng miễn → người đó vẫn chấm công (false); Quản trị chuyển → theo phòng", async () => {
    const HX = await sessionCookie(HRX);
    expect((await patchEmp(HX, HRX, { departmentId: deptEx })).status).toBe(200); // tự chuyển mình
    expect(await flag(HRX)).toBe(false);
    expect((await patchEmp(H, T, { departmentId: deptEx })).status).toBe(200);
    expect(await flag(T)).toBe(false);
    const mb = (await prisma.notificationLog.findMany({ where: { toGroupId: G_MB, dedupeKey: { startsWith: `grp:emp-update:${T}:` } } })).map((r) => r.payload).join();
    expect(mb).toContain("chỉ Quản trị được miễn");
    expect((await patchEmp(A, MX, { departmentId: deptEx })).status).toBe(200);
    expect(await flag(MX)).toBeNull(); // Quản trị chuyển: theo phòng (miễn)
    // nhập Excel vào phòng miễn bởi HR
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Nhân viên");
    ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
    const row: Record<string, string> = { code: code("J"), name: "QC Nhập BGĐ", department: `QC BGĐ ${tag}` };
    ws.addRow(IMPORT_COLUMNS.map((c) => row[c.key] ?? null));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await importRoute.POST(
      new NextRequest(new URL(`/api/employees/import?mode=commit&defaultShiftId=${hcId}&defaultPatternId=none`, BASE), {
        method: "POST",
        headers: { cookie: H, "content-type": "application/octet-stream" },
        body: new Uint8Array(buf),
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { code: code("J") } })).attendanceExempt).toBe(false);
    // khôi phục
    expect((await patchEmp(A, T, { departmentId: deptN, attendanceExempt: null })).status).toBe(200);
    expect(await flag(T)).toBeNull();
  });

  it("Xếp ca: ghi ô lịch cho người miễn bị từ chối (PUT /api/roster)", async () => {
    const r = await rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie: A, body: { cells: [{ employeeId: B, date: addDays(monday, 7), shiftId: hcId, isDayOff: false }] } }), ctx());
    expect(r.status).toBe(400);
    expect(await prisma.workSchedule.count({ where: { employeeId: B } })).toBe(0);
  });
});
