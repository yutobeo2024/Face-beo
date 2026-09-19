/**
 * QC đối kháng cho D2 (chốt công tháng) và D3 (nhắc đơn quá hạn).
 * Dùng tháng cách đây 4 tháng (payroll.test dùng 3 tháng), phòng ban / nhân viên / ca / mẫu tuần riêng.
 * Test đánh dấu là lỗi thật — cố ý để fail.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { TZ, addDays, startOfWeek, todayVN, vnDateTime, weekDates, weekday } from "@/lib/attendance";
import { recordScan, summarizeRange } from "@/lib/attendance-service";
import { buildAttendanceReport } from "@/lib/reports";
import { earliestLockDate, monthRange } from "@/lib/payroll-lock";
import { invalidatePayrollLockCache } from "@/lib/payroll-lock-state";
import { invalidatePermissionCache } from "@/lib/permissions";
import { requestOverdue } from "@/lib/jobs";
import { approversFor } from "@/lib/notify";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as locksRoute from "@/app/api/payroll-locks/route";
import * as unlockRoute from "@/app/api/payroll-locks/[month]/route";
import * as rosterRoute from "@/app/api/roster/route";
import * as registerRoute from "@/app/api/roster/register/route";
import * as copyRoute from "@/app/api/roster/copy-week/route";
import * as manualRoute from "@/app/api/attendance/manual/route";
import * as attendanceRoute from "@/app/api/attendance/route";
import * as logRoute from "@/app/api/attendance/[id]/route";
import * as meAttRoute from "@/app/api/me/attendance/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as cancelRoute from "@/app/api/requests/[id]/cancel/route";
import * as executeRoute from "@/app/api/requests/[id]/execute/route";

type Emp = { id: number; code: string; departmentId: number; name: string };
const TS = Date.now() % 1_000_000;
const HOUR = 3_600_000;

const MONTH = DateTime.fromISO(todayVN(), { zone: TZ }).startOf("month").minus({ months: 4 }).toFormat("yyyy-MM");
const { from: FIRST, to: LAST } = monthRange(MONTH);
const NEXT1 = addDays(LAST, 1);
const firstOnOrAfter = (d: string, wd: number) => {
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
};
const DAY1 = firstOnOrAfter(`${MONTH}-10`, 2); // thứ Ba
const DAY2 = addDays(DAY1, 1); // thứ Tư
const SAT = firstOnOrAfter(`${MONTH}-10`, 6);
let lastWeekday = LAST;
while (weekday(lastWeekday) >= 6) lastWeekday = addDays(lastWeekday, -1);

let admin: Emp, hr: Emp, mgr2: Emp;
let deptP: { id: number };
let mgrP: Emp, e1: Emp, e2: Emp, e3: Emp, e5: Emp, eR: Emp;
let A: string, H: string, MP: string, M2: string, E1: string;
let shHC: { id: number }, shHalf: { id: number }, shNight: { id: number };
let patA: { id: number }, patNight: { id: number }, patOff: { id: number };
const created: number[] = [];
const extraReqIds: number[] = [];
let holidayAdded = false;
let hrDecideRemoved = false;
let e1Day1LogId = 0;

const fakeNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};
const realNow = () => vi.useRealTimers();
/** ISO có offset VN. */
const vn = (date: string, hhmm: string) => vnDateTime(date, hhmm).toISOString();

const lock = (cookie: string, month: unknown = MONTH) => locksRoute.POST(req("/api/payroll-locks", { method: "POST", cookie, body: { month } }), ctx());
const unlock = (cookie: string, reason: string, month = MONTH) =>
  unlockRoute.DELETE(req(`/api/payroll-locks/${month}`, { method: "DELETE", cookie, body: { reason } }), ctx({ month }));
const report = async (e: Emp) => (await buildAttendanceReport({ id: e.id }, FIRST, LAST)).summary[0];
const scan = async (e: Emp, date: string, hhmm: string) => {
  const out = await recordScan({ employeeId: e.id, checkTime: vnDateTime(date, hhmm), source: "MANUAL", createdById: 1 });
  if (out.status !== "CREATED") throw new Error("scan not created");
  return out.log;
};
const meAtt = async (cookie: string, month = MONTH) => meAttRoute.GET(req(`/api/me/attendance?month=${month}`, { cookie }), ctx());
const dayList = async (cookie: string, extra = "") =>
  (await attendanceRoute.GET(req(`/api/attendance?from=${FIRST}&to=${LAST}&departmentId=${deptP.id}${extra}`, { cookie }), ctx())).json();
const dash = async (cookie: string) => (await (await dashboardRoute.GET(req("/api/dashboard", { cookie }), ctx())).json()) as { overdueRequests: number };
const count = (prefix: string) => prisma.notificationLog.count({ where: { dedupeKey: { startsWith: prefix } } });

async function mkEmp(i: number, name: string, role: string, scheduleType: "FIXED" | "ROTATING", workPatternId: number | null): Promise<Emp> {
  const passwordHash = (await prisma.employee.findUniqueOrThrow({ where: { code: "NV001" } })).passwordHash;
  const e = await prisma.employee.create({
    data: {
      code: `QCP${TS}${i}`.slice(0, 20),
      name,
      phone: `06${String(TS).padStart(6, "0")}${String(i).padStart(2, "0")}`,
      passwordHash,
      mustChangePassword: false,
      role,
      departmentId: deptP.id,
      defaultShiftId: shHC.id,
      scheduleType,
      workPatternId,
    },
  });
  created.push(e.id);
  return e;
}

beforeAll(async () => {
  await prisma.payrollLock.deleteMany({ where: { month: MONTH } });
  await prisma.lockedDay.deleteMany({ where: { month: MONTH } });
  invalidatePayrollLockCache();
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  mgr2 = await byCode("NV002");
  shHC = await prisma.shift.create({ data: { name: `QCP HC ${TS}`, startTime: "08:00", endTime: "17:00", breakMinutes: 60, breakStart: "12:00", graceLateMinutes: 5 } });
  shHalf = await prisma.shift.create({ data: { name: `QCP T7 ${TS}`, startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 5, workDayValue: 0.5 } });
  shNight = await prisma.shift.create({ data: { name: `QCP Đêm ${TS}`, startTime: "22:00", endTime: "06:00", breakMinutes: 60, graceLateMinutes: 5 } });
  const wk = (d: number | null, sat: number | null, sun: number | null) => ({ monShiftId: d, tueShiftId: d, wedShiftId: d, thuShiftId: d, friShiftId: d, satShiftId: sat, sunShiftId: sun });
  patA = await prisma.workPattern.create({ data: { name: `QCP A ${TS}`, ...wk(shHC.id, shHalf.id, null) } });
  patNight = await prisma.workPattern.create({ data: { name: `QCP Đêm ${TS}`, ...wk(shNight.id, shNight.id, shNight.id) } });
  patOff = await prisma.workPattern.create({ data: { name: `QCP Nghỉ ${TS}`, ...wk(null, null, null) } });
  deptP = await prisma.department.create({ data: { name: `QCP Phòng ${TS}` } });
  mgrP = await mkEmp(1, "QCP Quản lý", "MANAGER", "FIXED", patA.id);
  await prisma.department.update({ where: { id: deptP.id }, data: { managerId: mgrP.id } });
  e1 = await mkEmp(2, "QCP Một", "EMPLOYEE", "FIXED", patA.id);
  e2 = await mkEmp(3, "QCP Đêm", "EMPLOYEE", "FIXED", patNight.id);
  e3 = await mkEmp(4, "QCP Sẽ nghỉ việc", "EMPLOYEE", "FIXED", patA.id);
  e5 = await mkEmp(5, "QCP Đổi mẫu", "EMPLOYEE", "FIXED", patA.id);
  eR = await mkEmp(6, "QCP Xoay", "EMPLOYEE", "ROTATING", null);
  [A, H, MP, M2, E1] = await Promise.all([admin, hr, mgrP, mgr2, e1].map((e) => sessionCookie(e.id)));

  e1Day1LogId = (await scan(e1, DAY1, "07:58")).id;
  await scan(e1, DAY1, "17:02");
  await scan(e1, DAY2, "08:20");
  await scan(e1, DAY2, "17:00");
  await scan(e1, SAT, "07:58");
  await scan(e1, SAT, "12:01");
  await scan(e2, LAST, "21:58");
  await scan(e2, NEXT1, "06:03");
});

afterAll(async () => {
  realNow();
  await prisma.payrollLock.deleteMany({ where: { month: MONTH } });
  await prisma.lockedDay.deleteMany({ where: { month: MONTH } });
  invalidatePayrollLockCache();
  if (hrDecideRemoved) {
    await prisma.rolePermission.upsert({ where: { role_capability: { role: "HR", capability: "requests.decide" } }, create: { role: "HR", capability: "requests.decide" }, update: {} });
    invalidatePermissionCache();
  }
  await prisma.leaveRequest.deleteMany({ where: { OR: [{ employeeId: { in: created } }, { id: { in: extraReqIds } }] } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: created } } });
  await prisma.workSchedule.deleteMany({ where: { employeeId: { in: created } } });
  await prisma.rosterWeek.deleteMany({ where: { departmentId: deptP.id } });
  await prisma.departmentShiftWeight.deleteMany({ where: { departmentId: deptP.id } });
  if (holidayAdded) await prisma.holiday.delete({ where: { date: DAY1 } }).catch(() => {});
  await prisma.shift.update({ where: { id: shHC.id }, data: { startTime: "08:00" } });
  await prisma.shift.update({ where: { id: shHalf.id }, data: { workDayValue: 0.5 } });
  await prisma.department.update({ where: { id: deptP.id }, data: { managerId: null } });
  await prisma.employee.updateMany({ where: { id: { in: created } }, data: { active: false } });
});

// ---------------------------------------------------------------------------
describe("QC D2 — hàm thuần ranh giới tháng", () => {
  it("earliestLockDate = ngày 2 tháng sau (kể cả qua năm, tháng 2)", () => {
    expect(earliestLockDate("2026-05")).toBe("2026-06-02");
    expect(earliestLockDate("2026-12")).toBe("2027-01-02");
    expect(earliestLockDate("2024-01")).toBe("2024-02-02");
    expect(earliestLockDate("2024-02")).toBe("2024-03-02");
  });
  it("monthRange: tháng 2 nhuận / không nhuận, tháng 12", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthRange("2026-04").to).toBe("2026-04-30");
  });
});

describe("QC D2 — chốt công", () => {
  it("định dạng tháng sai => 400", async () => {
    for (const m of ["2026-5", "2026-13", "2026-00", "abcd-ef", "", ` ${MONTH}`, `${MONTH} `, "26-05", `${MONTH}-01`, 202605, null]) {
      expect((await lock(H, m)).status, `month=${JSON.stringify(m)}`).toBe(400);
    }
    expect((await locksRoute.POST(req("/api/payroll-locks", { method: "POST", cookie: H, body: {} }), ctx())).status).toBe(400);
  });

  it("tháng hiện tại / tương lai => 400", async () => {
    expect((await lock(H, todayVN().slice(0, 7))).status).toBe(400);
    expect((await lock(H, DateTime.fromISO(todayVN()).plus({ months: 1 }).toFormat("yyyy-MM"))).status).toBe(400);
    expect((await lock(H, "2099-12")).status).toBe(400);
    expect(await prisma.payrollLock.count({ where: { month: todayVN().slice(0, 7) } })).toBe(0);
  });

  it("nhân viên / quản lý => 403; quản lý xem danh sách được nhưng canLock=false", async () => {
    expect((await lock(E1)).status).toBe(403);
    expect((await lock(MP)).status).toBe(403);
    expect((await lock(M2)).status).toBe(403);
    const g = await locksRoute.GET(req("/api/payroll-locks", { cookie: M2 }), ctx());
    expect(g.status).toBe(200);
    expect((await g.json()).canLock).toBe(false);
    expect((await locksRoute.GET(req("/api/payroll-locks", { cookie: E1 }), ctx())).status).toBe(403);
    expect(await prisma.payrollLock.count({ where: { month: MONTH } })).toBe(0);
  });

  it("ranh giới: 23:59:59 ngày 1 tháng sau => 400; 00:00:01 ngày 2 => chốt được; chốt song song chỉ 1 thành công; tổng đúng", async () => {
    try {
      fakeNow(`${NEXT1}T23:59:59+07:00`);
      expect(todayVN()).toBe(NEXT1);
      expect((await lock(H)).status).toBe(400);
      const g = await (await locksRoute.GET(req("/api/payroll-locks", { cookie: H }), ctx())).json();
      const m = g.months.find((x: { month: string }) => x.month === MONTH);
      expect(m.lockable).toBe(false);
      expect(m.canLockFrom).toBe(addDays(NEXT1, 1));

      fakeNow(`${addDays(NEXT1, 1)}T00:00:01+07:00`);
      // Dự tính tổng như lúc chốt.
      const emps = await prisma.employee.findMany({ where: { OR: [{ active: true }, { logs: { some: { workDate: { gte: FIRST, lte: LAST } } } }] }, select: { id: true } });
      const { summaries } = await summarizeRange(emps.map((e) => e.id), FIRST, LAST);
      let wd = 0;
      let e1wd = 0;
      for (const [k, s] of summaries) {
        wd += s.workDayUnits;
        if (k.startsWith(`${e1.id}|`)) e1wd += s.workDayUnits;
      }
      expect(e1wd).toBe(2.5);

      const [r1, r2] = await Promise.all([lock(H), lock(H)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 400]);
      const ok = r1.status === 200 ? r1 : r2;
      const { totals } = await ok.json();
      expect(totals.employees).toBe(emps.length);
      expect(totals.workDays).toBe(Math.round(wd * 100) / 100);
      expect(totals.workDays % 1).not.toBe(0); // có ngày 0.5 của e1
      const days = DateTime.fromISO(LAST).day;
      expect(await prisma.lockedDay.count({ where: { month: MONTH } })).toBe(emps.length * days);
      expect(await prisma.payrollLock.count({ where: { month: MONTH } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "PAYROLL_LOCK", entityId: MONTH } })).toBe(1);
      expect(await count(`grp:payroll-lock:${MONTH}`)).toBe(1);
    } finally {
      realNow();
    }
    expect((await lock(H)).status).toBe(400); // chốt lần 2
    const r = await report(e1);
    expect(r.workDays).toBe(2.5);
    expect(r.lateCount).toBe(1);
  });
});

describe("QC D2 — bản chụp đứng yên sau khi chốt", () => {
  it("đổi giờ ca, hệ số ca, hệ số phòng, thêm ngày lễ, đổi mẫu tuần => báo cáo / công của tôi / bảng log không đổi", async () => {
    const before = {
      e1: await report(e1),
      e5: await report(e5),
      me: await (await meAtt(E1)).json(),
      list: await dayList(H),
    };
    expect(before.e5.absentDays).toBeGreaterThan(0);

    await prisma.shift.update({ where: { id: shHC.id }, data: { startTime: "08:30" } });
    await prisma.shift.update({ where: { id: shHalf.id }, data: { workDayValue: 1 } });
    await prisma.departmentShiftWeight.create({ data: { departmentId: deptP.id, shiftId: shHC.id, workDayValue: 0.5 } });
    await prisma.holiday.create({ data: { date: DAY1, name: `QCP lễ ${TS}` } });
    holidayAdded = true;
    await prisma.employee.update({ where: { id: e5.id }, data: { workPatternId: patOff.id } });

    expect(await report(e1)).toEqual(before.e1);
    expect(await report(e5)).toEqual(before.e5);
    expect(await (await meAtt(E1)).json()).toEqual(before.me);
    expect(await dayList(H)).toEqual(before.list);
  });

  it("dashboard (hôm nay) vẫn chạy khi có tháng đã chốt", async () => {
    expect((await dashboardRoute.GET(req("/api/dashboard", { cookie: H }), ctx())).status).toBe(200);
  });

  it("/api/me/attendance?month=YYYY-13 => 400 (không phải 500)", async () => {
    expect((await meAtt(E1, "2026-13")).status).toBe(400);
  });
});

describe("QC D2 — chặn ghi vào tháng đã chốt (409)", () => {
  it("xếp ca: chỉ ô trong tháng chốt => 409; lô giáp ranh => bỏ qua ô đã chốt, ghi ô tháng mới", async () => {
    const put = (cells: object[]) => rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie: A, body: { cells, reason: "QC thử sau chốt" } }), ctx());
    expect((await put([{ employeeId: eR.id, date: LAST, shiftId: shHC.id, isDayOff: false }])).status).toBe(409);
    const res = await put([
      { employeeId: eR.id, date: NEXT1, shiftId: shHC.id, isDayOff: false },
      { employeeId: eR.id, date: LAST, shiftId: shHC.id, isDayOff: false },
    ]);
    expect(res.status).toBe(200);
    expect((await res.json()).skippedLocked).toBe(1);
    expect(await prisma.workSchedule.count({ where: { employeeId: eR.id, date: LAST } })).toBe(0);
    expect(await prisma.workSchedule.count({ where: { employeeId: eR.id, date: NEXT1 } })).toBe(1);
    await prisma.workSchedule.deleteMany({ where: { employeeId: eR.id, date: NEXT1 } });
  });

  it("sao chép tuần vào tuần trong tháng chốt => 409; tuần giáp ranh => chỉ ghi các ngày ngoài tháng chốt", async () => {
    const src = startOfWeek(addDays(FIRST, -28));
    for (const d of weekDates(src)) await prisma.workSchedule.create({ data: { employeeId: eR.id, date: d, shiftId: shHC.id, isDayOff: false } });
    const copy = (toWeek: string) => copyRoute.POST(req("/api/roster/copy-week", { method: "POST", cookie: A, body: { fromWeek: src, toWeek, departmentId: deptP.id, reason: "QC sao chép" } }), ctx());
    expect((await copy(startOfWeek(`${MONTH}-15`))).status).toBe(409);
    const straddle = startOfWeek(FIRST);
    if (straddle < FIRST) {
      // Tuần giáp ranh (cuối tháng trước + đầu tháng chốt): chỉ ghi các ngày của tháng trước, bỏ qua ngày đã chốt.
      expect((await copy(straddle)).status).toBe(200);
      expect(await prisma.workSchedule.count({ where: { employeeId: eR.id, date: { gte: FIRST, lte: addDays(straddle, 6) } } })).toBe(0);
      expect(await prisma.workSchedule.count({ where: { employeeId: eR.id, date: { gte: straddle, lt: FIRST } } })).toBeGreaterThan(0);
      await prisma.workSchedule.deleteMany({ where: { employeeId: eR.id, date: { gte: straddle, lt: FIRST } } });
    }
    expect(await prisma.workSchedule.count({ where: { employeeId: eR.id, date: { gte: FIRST, lte: LAST } } })).toBe(0);
  });

  it("đăng ký tuần: trọn trong tháng chốt => 409; giáp ranh => 200", async () => {
    const reg = (week: string) => registerRoute.POST(req("/api/roster/register", { method: "POST", cookie: H, body: { week, departmentIds: [deptP.id] } }), ctx());
    let straddles = 0;
    for (let w = startOfWeek(FIRST); w <= LAST; w = addDays(w, 7)) {
      const inside = weekDates(w).every((d) => d >= FIRST && d <= LAST);
      const res = await reg(w);
      expect(res.status, `week ${w}`).toBe(inside ? 409 : 200);
      if (!inside) straddles++;
    }
    expect(straddles).toBeGreaterThan(0);
  });

  it("chấm tay: ngày trong tháng chốt => 409; 00:30 ngày 1 tháng sau của người ca đêm (thuộc ngày cuối tháng) => 409; người ca ngày => 201", async () => {
    const man = (e: Emp, iso: string) =>
      manualRoute.POST(req("/api/attendance/manual", { method: "POST", cookie: A, body: { employeeId: e.id, checkTime: iso, reason: "QC chấm tay" } }), ctx());
    expect((await man(e1, vn(DAY1, "12:00"))).status).toBe(409);
    expect((await man(e2, vn(NEXT1, "00:30"))).status).toBe(409);
    const ok = await man(e1, vn(NEXT1, "08:00"));
    expect(ok.status).toBe(201);
    expect((await ok.json()).log.workDate).toBe(NEXT1);
    await expect(recordScan({ employeeId: e2.id, checkTime: vnDateTime(NEXT1, "00:30"), source: "KIOSK" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.attendanceLog.count({ where: { employeeId: e2.id, checkTime: vnDateTime(NEXT1, "00:30") } })).toBe(0);
  });

  it("quét thuộc ngày 1 tháng mới vẫn ghi được; recomputeDay không gán lại log của ngày đã chốt", async () => {
    const snapLogs = async () =>
      (await prisma.attendanceLog.findMany({ where: { employeeId: e2.id, workDate: LAST }, orderBy: { id: "asc" } })).map((l) => ({
        id: l.id,
        workDate: l.workDate,
        shiftId: l.shiftId,
        type: l.type,
        note: l.note,
        isLate: l.isLate,
        isEarly: l.isEarly,
      }));
    const before = await snapLogs();
    expect(before.length).toBe(2);
    expect(before.every((l) => l.shiftId === shNight.id)).toBe(true);
    // Đổi lịch: không còn ca đêm => nếu tính lại, log ngày cuối tháng sẽ bị gán "Ngoài ca".
    await prisma.employee.update({ where: { id: e2.id }, data: { workPatternId: patOff.id } });
    try {
      const out = await recordScan({ employeeId: e2.id, checkTime: vnDateTime(NEXT1, "07:00"), source: "MANUAL", createdById: admin.id });
      expect(out.status).toBe("CREATED");
      if (out.status === "CREATED") expect(out.log.workDate).toBe(NEXT1);
      expect(await snapLogs()).toEqual(before);
    } finally {
      await prisma.employee.update({ where: { id: e2.id }, data: { workPatternId: patNight.id } });
    }
  });

  it("xóa log thuộc tháng chốt => 409", async () => {
    const del = await logRoute.DELETE(req(`/api/attendance/${e1Day1LogId}`, { method: "DELETE", cookie: A, body: { reason: "QC xóa log" } }), ctx({ id: String(e1Day1LogId) }));
    expect(del.status).toBe(409);
    expect(await prisma.attendanceLog.count({ where: { id: e1Day1LogId } })).toBe(1);
  });

  it("chấm tay theo đơn bổ sung công (đơn còn hạn 7 ngày) cho ngày trong tháng chốt => 409, đơn vẫn chờ chấm", async () => {
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: e1.id,
        type: "BO_SUNG_CONG",
        status: "APPROVED",
        fromTime: vnDateTime(lastWeekday, "17:00"),
        toTime: new Date(vnDateTime(lastWeekday, "17:00").getTime() + 60_000),
        correctionAt: vnDateTime(lastWeekday, "17:00"),
        correctionKind: "OUT",
        reason: "QC quên chấm ra cuối tháng",
        approverId: mgrP.id,
        decidedAt: vnDateTime(lastWeekday, "18:00"),
      },
    });
    const logsBefore = await prisma.attendanceLog.count({ where: { employeeId: e1.id } });
    try {
      fakeNow(`${addDays(NEXT1, 1)}T10:00:00+07:00`);
      const res = await executeRoute.POST(req(`/api/requests/${r.id}/execute`, { method: "POST", cookie: H, body: {} }), ctx({ id: String(r.id) }));
      expect(res.status).toBe(409);
    } finally {
      realNow();
    }
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.executedAt).toBeNull();
    expect(await prisma.attendanceLog.count({ where: { employeeId: e1.id } })).toBe(logsBefore);
  });

  it("tạo đơn: phủ tháng chốt + tháng mới => 409; kết thúc đúng 00:00 ngày 1 => 409; bắt đầu đúng 00:00 ngày 1 => 201", async () => {
    const post = (fromTime: string, toTime: string) =>
      requestsRoute.POST(req("/api/requests", { method: "POST", cookie: E1, body: { type: "NGHI_PHEP", fromTime, toTime, reason: "QC đơn giáp ranh tháng chốt" } }), ctx());
    try {
      fakeNow(`${addDays(NEXT1, 1)}T10:00:00+07:00`);
      expect((await post(vn(addDays(LAST, -1), "08:00"), vn(NEXT1, "17:00"))).status).toBe(409);
      expect((await post(vn(LAST, "13:00"), vn(NEXT1, "00:00"))).status).toBe(409);
      const ok = await post(vn(NEXT1, "00:00"), vn(NEXT1, "12:00"));
      expect(ok.status).toBe(201);
    } finally {
      realNow();
    }
  });

  it("đơn phủ tháng chốt: DUYỆT => 409 (giữ PENDING); TỪ CHỐI / HỦY vẫn được (không treo mãi); đơn tháng mới duyệt được", async () => {
    const span = await prisma.leaveRequest.create({
      data: { employeeId: e1.id, type: "NGHI_PHEP", status: "PENDING", fromTime: vnDateTime(lastWeekday, "08:00"), toTime: vnDateTime(NEXT1, "17:00"), reason: "QC đơn giáp ranh" },
    });
    const dec = (id: number, cookie: string) => decideRoute.POST(req(`/api/requests/${id}/decide`, { method: "POST", cookie, body: { action: "APPROVE" } }), ctx({ id: String(id) }));
    expect((await dec(span.id, MP)).status).toBe(409);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: span.id } })).status).toBe("PENDING");
    const rej = await decideRoute.POST(req(`/api/requests/${span.id}/decide`, { method: "POST", cookie: MP, body: { action: "REJECT", note: "Tháng đã chốt công" } }), ctx({ id: String(span.id) }));
    expect(rej.status).toBe(200);
    const span2 = await prisma.leaveRequest.create({
      data: { employeeId: e1.id, type: "NGHI_PHEP", status: "PENDING", fromTime: vnDateTime(lastWeekday, "08:00"), toTime: vnDateTime(lastWeekday, "17:00"), reason: "QC đơn trong tháng chốt" },
    });
    expect((await cancelRoute.POST(req(`/api/requests/${span2.id}/cancel`, { method: "POST", cookie: E1 }), ctx({ id: String(span2.id) }))).status).toBe(200);

    const fresh = await prisma.leaveRequest.create({
      data: { employeeId: e1.id, type: "VE_SOM", status: "PENDING", fromTime: vnDateTime(NEXT1, "16:00"), toTime: vnDateTime(NEXT1, "17:00"), reason: "QC đơn tháng mới" },
    });
    expect((await dec(fresh.id, MP)).status).toBe(200);
  });
});

describe("QC D2 — nhân viên nghỉ việc / vào làm sau khi chốt", () => {
  it("nghỉ việc sau khi chốt vẫn có trong bảng công tháng đã chốt (số liệu giữ nguyên)", async () => {
    const before = await report(e3);
    expect(before.absentDays).toBeGreaterThan(0);
    await prisma.employee.update({ where: { id: e3.id }, data: { active: false } });
    const r = await buildAttendanceReport({ departmentId: deptP.id }, FIRST, LAST);
    const row = r.summary.find((x) => x.employeeId === e3.id);
    expect(row).toBeDefined();
    expect(row).toEqual(before);
  });

  it("chuyển phòng sau khi chốt: bảng công tháng đã chốt theo phòng cũ vẫn phải giữ người đó", async () => {
    const before = (await buildAttendanceReport({ departmentId: deptP.id }, FIRST, LAST)).summary.find((x) => x.employeeId === e5.id);
    expect(before).toBeDefined();
    const other = await prisma.department.create({ data: { name: `QCP Phòng khác ${TS}` } });
    await prisma.employee.update({ where: { id: e5.id }, data: { departmentId: other.id } });
    try {
      const after = (await buildAttendanceReport({ departmentId: deptP.id }, FIRST, LAST)).summary.find((x) => x.employeeId === e5.id);
      expect(after).toEqual(before);
    } finally {
      await prisma.employee.update({ where: { id: e5.id }, data: { departmentId: deptP.id } });
    }
  });

  it("vào làm sau khi chốt: có trong bảng công với 0 công, không bị tính vắng", async () => {
    const e6 = await mkEmp(7, "QCP Vào sau chốt", "EMPLOYEE", "FIXED", patA.id);
    const r = await buildAttendanceReport({ departmentId: deptP.id }, FIRST, LAST);
    const row = r.summary.find((x) => x.employeeId === e6.id)!;
    expect(row).toBeDefined();
    expect(row.workDays).toBe(0);
    expect(row.absentDays).toBe(0);
    expect(row.leaveDays).toBe(0);
    const absent = await dayList(H, "&flag=absent");
    expect(absent.rows.some((x: { employee: { id: number } }) => x.employee.id === e6.id)).toBe(false);
    const me = await (await meAtt(await sessionCookie(e6.id))).json();
    expect(me.totals.absentDays).toBe(0);
    expect(me.totals.workDays).toBe(0);
  });
});

describe("QC D2 — mở khóa", () => {
  it("HR 403; lý do rỗng / ngắn / chỉ khoảng trắng => 400; tháng sai / chưa chốt => 400", async () => {
    expect((await unlock(H, "Lý do đầy đủ")).status).toBe(403);
    expect((await unlock(MP, "Lý do đầy đủ")).status).toBe(403);
    expect((await unlock(A, "")).status).toBe(400);
    expect((await unlock(A, "abcd")).status).toBe(400);
    expect((await unlock(A, "     abcd      ")).status).toBe(400);
    expect((await unlock(A, "Lý do đầy đủ", "2026-13")).status).toBe(400);
    const notLocked = DateTime.fromISO(`${MONTH}-01`).minus({ years: 3 }).toFormat("yyyy-MM");
    expect((await unlock(A, "Lý do đầy đủ", notLocked)).status).toBe(400);
    expect(await prisma.payrollLock.count({ where: { month: MONTH } })).toBe(1);
  });

  it("Quản trị mở khóa => 200; nhật ký + tin nhóm; số liệu tính lại theo dữ liệu hiện tại; hết chặn 409", async () => {
    const res = await unlock(A, "QC bổ sung ngày lễ bị sót");
    expect(res.status).toBe(200);
    expect(await prisma.payrollLock.count({ where: { month: MONTH } })).toBe(0);
    expect(await prisma.lockedDay.count({ where: { month: MONTH } })).toBe(0);
    const a = await prisma.auditLog.findFirst({ where: { action: "PAYROLL_UNLOCK", entityId: MONTH }, orderBy: { id: "desc" } });
    expect(a?.actorId).toBe(admin.id);
    expect(a?.detail).toContain("QC bổ sung ngày lễ bị sót");
    const n = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `grp:payroll-unlock:${MONTH}` } } });
    expect(n.length).toBe(1);
    expect(n[0].messageType).toBe("GROUP_EVENT");
    expect(n[0].payload).toContain("QC bổ sung ngày lễ bị sót");
    expect((await unlock(A, "QC mở khóa lần hai")).status).toBe(400);

    // DAY1 thành ngày lễ (0 công), DAY2 hệ số phòng 0.5 và không còn trễ (ca bắt đầu 08:30), SAT hệ số 1.
    const r1 = await report(e1);
    expect(r1.workDays).toBe(1.5);
    expect(r1.lateCount).toBe(0);
    expect((await report(e5)).absentDays).toBe(0);

    const put = await rosterRoute.PUT(
      req("/api/roster", { method: "PUT", cookie: A, body: { cells: [{ employeeId: eR.id, date: LAST, shiftId: shHC.id, isDayOff: false }], reason: "QC sau mở khóa" } }),
      ctx(),
    );
    expect(put.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("QC D3 — nhắc đơn quá hạn", () => {
  const far = addDays(todayVN(), 50);
  const mk = (employeeId: number, createdAt: Date, extra: Partial<{ type: string; status: string; decidedAt: Date; correction: boolean }> = {}) =>
    prisma.leaveRequest
      .create({
        data: {
          employeeId,
          type: extra.type ?? "NGHI_PHEP",
          status: extra.status ?? "PENDING",
          fromTime: vnDateTime(far, "08:00"),
          toTime: vnDateTime(far, extra.correction ? "08:01" : "12:00"),
          correctionAt: extra.correction ? vnDateTime(far, "08:00") : null,
          correctionKind: extra.correction ? "IN" : null,
          reason: "QC D3 đơn quá hạn",
          createdAt,
          decidedAt: extra.decidedAt ?? null,
        },
      })
      .then((r) => {
        extraReqIds.push(r.id);
        return r;
      });

  it("người tạo đơn là Quản trị: không tự nhắc / tự báo chính mình", async () => {
    const now = new Date();
    const r = await mk(admin.id, new Date(now.getTime() - 49 * HOUR));
    await requestOverdue(now);
    expect(await count(`req-overdue24:${r.id}:${admin.id}`)).toBe(0);
    expect(await count(`req-overdue48:${r.id}:${admin.id}`)).toBe(0);
    const handlers = (await approversFor(admin.id)).filter((id) => id !== admin.id);
    expect(await count(`req-overdue24:${r.id}:`)).toBe(handlers.length);
    expect(await count(`grp:req-overdue48:${r.id}`)).toBe(1);
  });

  it("không có người duyệt nào: không lỗi, vẫn báo nhóm với '(không có)'", async () => {
    const otherAdmins = await prisma.employee.count({ where: { role: "ADMIN", active: true, id: { not: admin.id } } });
    await prisma.rolePermission.deleteMany({ where: { role: "HR", capability: "requests.decide" } });
    hrDecideRemoved = true;
    invalidatePermissionCache();
    try {
      if (otherAdmins === 0) expect(await approversFor(admin.id)).toEqual([]);
      const now = new Date();
      const r = await mk(admin.id, new Date(now.getTime() - 50 * HOUR));
      await expect(requestOverdue(now)).resolves.toBeDefined();
      if (otherAdmins === 0) expect(await count(`req-overdue24:${r.id}:`)).toBe(0);
      const g = await prisma.notificationLog.findUnique({ where: { dedupeKey: `grp:req-overdue48:${r.id}` } });
      expect(g).not.toBeNull();
      if (otherAdmins === 0) expect(g!.payload).toContain("(không có)");
    } finally {
      await prisma.rolePermission.upsert({ where: { role_capability: { role: "HR", capability: "requests.decide" } }, create: { role: "HR", capability: "requests.decide" }, update: {} });
      hrDecideRemoved = false;
      invalidatePermissionCache();
    }
  });

  it("đơn quá 60 ngày bị bỏ qua; 59 ngày vẫn nhắc", async () => {
    const now = new Date();
    const old = await mk(e1.id, new Date(now.getTime() - 61 * 24 * HOUR));
    const edge = await mk(e1.id, new Date(now.getTime() - 59 * 24 * HOUR));
    await requestOverdue(now);
    expect(await count(`req-overdue24:${old.id}:`)).toBe(0);
    expect(await count(`grp:req-overdue48:${old.id}`)).toBe(0);
    expect(await count(`req-overdue24:${edge.id}:${mgrP.id}`)).toBe(1);
    expect(await count(`grp:req-overdue48:${edge.id}`)).toBe(1);
  });

  it("bổ sung công CHƯA duyệt: tính theo lúc tạo, nhắc người duyệt (không phải người chấm tay)", async () => {
    const now = new Date();
    const r = await mk(e1.id, new Date(now.getTime() - 25 * HOUR), { type: "BO_SUNG_CONG", correction: true });
    await requestOverdue(now);
    expect(await count(`req-overdue24:${r.id}:`)).toBe(1);
    expect(await count(`req-overdue24:${r.id}:${mgrP.id}`)).toBe(1);
    expect(await count(`corr-overdue24:${r.id}:`)).toBe(0);
    expect(await count(`grp:req-overdue48:${r.id}`)).toBe(0);
  });

  it("dashboard overdueRequests: quản lý thấy đơn chờ duyệt phòng mình; Nhân sự thấy đơn chờ chấm tay; quản lý phòng khác không thấy", async () => {
    const before = { A: (await dash(A)).overdueRequests, H: (await dash(H)).overdueRequests, MP: (await dash(MP)).overdueRequests, M2: (await dash(M2)).overdueRequests };
    const now = Date.now();
    await mk(e1.id, new Date(now - 30 * HOUR));
    await mk(e1.id, new Date(now - 23 * HOUR)); // chưa quá hạn
    await mk(e1.id, new Date(now - 60 * HOUR), { type: "BO_SUNG_CONG", status: "APPROVED", decidedAt: new Date(now - 30 * HOUR), correction: true });
    const after = { A: (await dash(A)).overdueRequests, H: (await dash(H)).overdueRequests, MP: (await dash(MP)).overdueRequests, M2: (await dash(M2)).overdueRequests };
    expect(after.MP - before.MP).toBe(1);
    expect(after.H - before.H).toBe(1);
    expect(after.A - before.A).toBe(2);
    expect(after.M2 - before.M2).toBe(0);
  });
});
