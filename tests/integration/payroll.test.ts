import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { TZ, todayVN, vnDateTime, weekday, addDays } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { buildAttendanceReport } from "@/lib/reports";
import { invalidatePayrollLockCache } from "@/lib/payroll-lock-state";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as locksRoute from "@/app/api/payroll-locks/route";
import * as unlockRoute from "@/app/api/payroll-locks/[month]/route";
import * as rosterRoute from "@/app/api/roster/route";
import * as manualRoute from "@/app/api/attendance/manual/route";
import * as logRoute from "@/app/api/attendance/[id]/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as cancelRoute from "@/app/api/requests/[id]/cancel/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, emp: E, leaver: E;
let A: string, H: string, M: string;
// Tháng cách đây 3 tháng: không trùng ngày với các file test khác.
const MONTH = DateTime.fromISO(todayVN(), { zone: TZ }).startOf("month").minus({ months: 3 }).toFormat("yyyy-MM");
let DAY: string; // một ngày thứ Ba trong tháng
let logId: number;

const lock = (cookie: string, month = MONTH) => locksRoute.POST(req("/api/payroll-locks", { method: "POST", cookie, body: { month } }), ctx());
const unlock = (cookie: string, reason: string) =>
  unlockRoute.DELETE(req(`/api/payroll-locks/${MONTH}`, { method: "DELETE", cookie, body: { reason } }), ctx({ month: MONTH }));
const report = async (e: E) => (await buildAttendanceReport({ id: e.id }, `${MONTH}-01`, DateTime.fromISO(`${MONTH}-01`).endOf("month").toISODate()!)).summary[0];

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  mgr = await byCode("NV002");
  emp = await byCode("NV008");
  leaver = await byCode("NV009");
  [A, H, M] = await Promise.all([admin, hr, mgr].map((e) => sessionCookie(e.id)));
  DAY = `${MONTH}-10`;
  while (weekday(DAY) !== 2) DAY = addDays(DAY, 1);
  await prisma.payrollLock.deleteMany();
  await prisma.lockedDay.deleteMany();
  invalidatePayrollLockCache();
  for (const e of [emp, leaver]) {
    await prisma.attendanceLog.deleteMany({ where: { employeeId: e.id, workDate: DAY } });
    const a = await recordScan({ employeeId: e.id, checkTime: vnDateTime(DAY, "07:58"), source: "MANUAL", createdById: admin.id });
    await recordScan({ employeeId: e.id, checkTime: vnDateTime(DAY, "17:02"), source: "MANUAL", createdById: admin.id });
    if (e === emp && a.status === "CREATED") logId = a.log.id;
  }
});

afterAll(async () => {
  await prisma.payrollLock.deleteMany();
  await prisma.lockedDay.deleteMany();
  invalidatePayrollLockCache();
  await prisma.holiday.deleteMany({ where: { date: DAY } });
  await prisma.employee.update({ where: { id: leaver.id }, data: { active: true } });
});

describe("chốt công tháng", () => {
  it("Quản lý không chốt được; tháng chưa kết thúc => 400; HR chốt => 200, có nhật ký + tin nhóm", async () => {
    expect((await lock(M)).status).toBe(403);
    expect((await lock(H, todayVN().slice(0, 7))).status).toBe(400);
    const before = await report(emp);
    expect(before.workDays).toBeGreaterThanOrEqual(1);
    const res = await lock(H);
    expect(res.status).toBe(200);
    expect((await res.json()).totals.employees).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "PAYROLL_LOCK", entityId: MONTH } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `grp:payroll-lock:${MONTH}` } } })).toBe(1);
    expect((await lock(H)).status).toBe(400); // đã chốt
    const list = await (await locksRoute.GET(req("/api/payroll-locks", { cookie: H }), ctx())).json();
    expect(list.canLock).toBe(true);
    expect(list.canUnlock).toBe(false);
  });

  it("sau khi chốt: thêm ngày lễ vào tháng đó không làm đổi bảng công (bản chụp)", async () => {
    const before = await report(emp);
    await prisma.holiday.create({ data: { date: DAY, name: "Lễ thử sau chốt" } });
    const after = await report(emp);
    expect(after.workDays).toBe(before.workDays);
    expect(after.absentDays).toBe(before.absentDays);
  });

  it("người nghỉ việc sau khi chốt vẫn có trong bảng công tháng đã chốt", async () => {
    await prisma.employee.update({ where: { id: leaver.id }, data: { active: false } });
    const r = await buildAttendanceReport({ departmentId: leaver.departmentId }, `${MONTH}-01`, `${MONTH}-28`);
    expect(r.summary.some((x) => x.employeeId === leaver.id)).toBe(true);
  });

  it("chặn mọi thao tác ghi vào tháng đã chốt (409)", async () => {
    const hc = await prisma.shift.findUniqueOrThrow({ where: { name: "Hành chính" } });
    const put = await rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie: A, body: { cells: [{ employeeId: emp.id, date: DAY, shiftId: hc.id, isDayOff: false }], reason: "Thử sửa sau chốt" } }), ctx());
    expect(put.status).toBe(409);
    const man = await manualRoute.POST(req("/api/attendance/manual", { method: "POST", cookie: A, body: { employeeId: emp.id, checkTime: vnDateTime(DAY, "12:00").toISOString(), reason: "Thử chấm tay" } }), ctx());
    expect(man.status).toBe(409);
    const del = await logRoute.DELETE(req(`/api/attendance/${logId}`, { method: "DELETE", cookie: A, body: { reason: "Thử xóa log" } }), ctx({ id: String(logId) }));
    expect(del.status).toBe(409);
    expect(await prisma.attendanceLog.count({ where: { id: logId } })).toBe(1);
    const r = await prisma.leaveRequest.create({
      data: { employeeId: emp.id, type: "NGHI_PHEP", status: "PENDING", fromTime: vnDateTime(DAY, "13:00"), toTime: vnDateTime(DAY, "17:00"), reason: "Đơn cũ trong tháng đã chốt" },
    });
    const dec = await decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", cookie: A, body: { action: "APPROVE" } }), ctx({ id: String(r.id) }));
    expect(dec.status).toBe(409);
    const can = await cancelRoute.POST(req(`/api/requests/${r.id}/cancel`, { method: "POST", cookie: await sessionCookie(emp.id) }), ctx({ id: String(r.id) }));
    expect(can.status).toBe(409);
    await prisma.leaveRequest.delete({ where: { id: r.id } });
  });

  it("mở khóa: HR 403; Quản trị thiếu lý do 400; có lý do => mở, bảng công tính lại theo dữ liệu hiện tại", async () => {
    expect((await unlock(H, "Bổ sung đơn nghỉ")).status).toBe(403);
    expect((await unlock(A, "  ")).status).toBe(400);
    const before = await report(emp);
    const res = await unlock(A, "Bổ sung ngày lễ bị sót");
    expect(res.status).toBe(200);
    expect(await prisma.lockedDay.count({ where: { month: MONTH } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "PAYROLL_UNLOCK", entityId: MONTH } })).toBe(1);
    const after = await report(emp);
    // Ngày lễ vừa thêm giờ có hiệu lực: ngày DAY thành làm ngày lễ (0 công).
    expect(after.workDays).toBe(before.workDays - 1);
  });
});
