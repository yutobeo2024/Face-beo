/**
 * QC đối kháng v1.2 A: hệ số công theo ca/phòng, nửa ngày phép, trừ giờ nghỉ (D1), báo cáo số lẻ.
 * Dùng phòng ban / ca / nhân viên riêng (tạo trong beforeAll), tháng 07/2026 (quá khứ) và một thứ Hai ~6 tuần tới.
 * Test đánh dấu là lỗi thật — cố ý để fail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan, summarizeRange } from "@/lib/attendance-service";
import { buildAttendanceReport } from "@/lib/reports";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as shiftRoute from "@/app/api/shifts/[id]/route";
import * as weightsRoute from "@/app/api/shift-weights/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as meRoute from "@/app/api/me/attendance/route";
import * as xlsxRoute from "@/app/api/reports/attendance.xlsx/route";

type Emp = { id: number; code: string; departmentId: number; name: string };
type Sh = { id: number; name: string; workDayValue: number; breakStart: string | null };
const TS = Date.now() % 1_000_000;
const MONTH = "2026-07";
const J = (d: number) => `2026-07-${String(d).padStart(2, "0")}`;
const HOLIDAY = J(15);

let admin: Emp;
let A: string, H: string, M: string, E: string;
let sHC: Sh, sHalf: Sh, sNight: Sh;
let dA: { id: number }, dF: { id: number }, dH: { id: number }, dM1: { id: number }, dM2: { id: number };
let eA: Emp, eMix: Emp, eNight: Emp, eF: Emp, eH: Emp, eMv: Emp;
let pMix: { id: number };
let FUT: string;
let createdHoliday = false;
const created: number[] = [];

const scan = async (e: Emp, date: string, hhmm: string) => {
  const out = await recordScan({ employeeId: e.id, checkTime: vnDateTime(date, hhmm), source: "MANUAL", createdById: admin.id });
  if (out.status !== "CREATED") throw new Error("scan not created");
};
const leave = (e: Emp, fromD: string, fromT: string, toD: string, toT: string, status = "APPROVED") =>
  prisma.leaveRequest.create({ data: { employeeId: e.id, type: "NGHI_PHEP", status, fromTime: vnDateTime(fromD, fromT), toTime: vnDateTime(toD, toT), reason: "QC nghỉ phép" } });
const day = async (e: Emp, d: string) => (await summarizeRange([e.id], d, d)).summaries.get(`${e.id}|${d}`)!;
const monthRow = async (e: Emp) => (await buildAttendanceReport({ id: e.id }, J(1), J(31))).summary[0];
const meTotals = async (e: Emp) => {
  const res = await meRoute.GET(req(`/api/me/attendance?month=${MONTH}`, { cookie: await sessionCookie(e.id) }), ctx());
  expect(res.status).toBe(200);
  return (await res.json()).totals as { workDays: number; leaveDays: number; workMinutes: number };
};
const patchShift = (cookie: string, id: number, body: object) => shiftRoute.PATCH(req(`/api/shifts/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
const putWeights = (cookie: string, weights: unknown) => weightsRoute.PUT(req("/api/shift-weights", { method: "PUT", cookie, body: { weights } }), ctx());
const getWeights = (cookie: string) => weightsRoute.GET(req("/api/shift-weights", { cookie }), ctx());
const groupEvents = () => prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });

async function mkEmp(i: number, name: string, departmentId: number, defaultShiftId: number, workPatternId: number | null = null): Promise<Emp> {
  const passwordHash = (await prisma.employee.findUniqueOrThrow({ where: { code: "NV001" } })).passwordHash;
  const e = await prisma.employee.create({
    data: {
      code: `QCW${TS}${i}`.slice(0, 20),
      name,
      phone: `07${String(TS).padStart(6, "0")}${String(i).padStart(2, "0")}`,
      passwordHash,
      mustChangePassword: false,
      role: "EMPLOYEE",
      departmentId,
      defaultShiftId,
      scheduleType: "FIXED",
      workPatternId,
    },
  });
  created.push(e.id);
  return e;
}

beforeAll(async () => {
  admin = await byCode("NV001");
  [A, H, M, E] = await Promise.all(["NV001", "NV016", "NV002", "NV007"].map(async (c) => sessionCookie((await byCode(c)).id)));
  sHC = await prisma.shift.create({ data: { name: `QCW HC ${TS}`, startTime: "08:00", endTime: "17:00", breakMinutes: 60, breakStart: "12:00", graceLateMinutes: 5 } });
  sHalf = await prisma.shift.create({ data: { name: `QCW T7 ${TS}`, startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 5, workDayValue: 0.5 } });
  sNight = await prisma.shift.create({ data: { name: `QCW Dem ${TS}`, startTime: "22:00", endTime: "06:00", breakMinutes: 60, breakStart: "02:00", graceLateMinutes: 5 } });
  pMix = await prisma.workPattern.create({
    data: { name: `QCW T2–T6 + T7 ${TS}`, monShiftId: sHC.id, tueShiftId: sHC.id, wedShiftId: sHC.id, thuShiftId: sHC.id, friShiftId: sHC.id, satShiftId: sHalf.id, sunShiftId: null },
  });
  [dA, dF, dH, dM1, dM2] = await Promise.all(["A", "F", "H", "M1", "M2"].map((n) => prisma.department.create({ data: { name: `QCW ${n} ${TS}` } })));
  eA = await mkEmp(1, "QCW Nửa ngày", dA.id, sHC.id);
  eMix = await mkEmp(2, "QCW Hỗn hợp", dA.id, sHC.id, pMix.id);
  eNight = await mkEmp(3, "QCW Ca đêm", dA.id, sNight.id);
  eF = await mkEmp(4, "QCW Hệ số 0.25", dF.id, sHC.id);
  eH = await mkEmp(5, "QCW Làm lễ", dH.id, sHC.id);
  eMv = await mkEmp(6, "QCW Chuyển phòng", dM1.id, sHC.id);
  FUT = addDays(startOfWeek(todayVN()), 42);
  expect(weekday(FUT)).toBe(1);
  expect(weekday(J(6))).toBe(1);
  expect(weekday(J(11))).toBe(6);
  if (!(await prisma.holiday.findUnique({ where: { date: HOLIDAY } }))) {
    await prisma.holiday.create({ data: { date: HOLIDAY, name: `QCW lễ ${TS}` } });
    createdHoliday = true;
  }
});

afterAll(async () => {
  await prisma.departmentShiftWeight.deleteMany({ where: { departmentId: { in: [dA, dF, dH, dM1, dM2].map((d) => d.id) } } });
  await prisma.workSchedule.deleteMany({ where: { employeeId: { in: created } } });
  await prisma.rosterWeek.deleteMany({ where: { departmentId: dH.id } });
  await prisma.employee.updateMany({ where: { id: { in: created } }, data: { active: false } });
  if (createdHoliday) await prisma.holiday.delete({ where: { date: HOLIDAY } }).catch(() => {});
});

// ---------------------------------------------------------------------------
describe("QC nửa ngày phép (luồng đầy đủ qua DB)", () => {
  it("làm sáng + phép chiều đúng nửa => 0.5 + 0.5; giờ công 240", async () => {
    await scan(eA, J(6), "07:57");
    await scan(eA, J(6), "12:02");
    await leave(eA, J(6), "13:00", J(6), "17:00");
    expect(await day(eA, J(6))).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5, workMinutes: 240 });
  });

  it("phép sáng 08–12 + làm chiều 12:58–17:02 => 0.5 + 0.5; giờ công 240 (không trừ nghỉ trưa)", async () => {
    await leave(eA, J(7), "08:00", J(7), "12:00");
    await scan(eA, J(7), "12:58");
    await scan(eA, J(7), "17:02");
    expect(await day(eA, J(7))).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5, workMinutes: 240 });
  });

  it("phép 13:01–17:00 (thiếu 1 phút so với nửa) => 1 công", async () => {
    await scan(eA, J(8), "07:57");
    await scan(eA, J(8), "13:01");
    await leave(eA, J(8), "13:01", J(8), "17:00");
    expect(await day(eA, J(8))).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
  });

  it("phép 10:00–15:00 phủ giờ nghỉ (300 − 60 = 240) => 0.5 + 0.5", async () => {
    for (const t of ["07:58", "10:00", "15:00", "17:02"]) await scan(eA, J(9), t);
    await leave(eA, J(9), "10:00", J(9), "15:00");
    expect(await day(eA, J(9))).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("hai đơn nối tiếp 13–15 + 15–17 được gộp => 0.5 + 0.5", async () => {
    await scan(eA, J(10), "07:58");
    await scan(eA, J(10), "12:03");
    await leave(eA, J(10), "13:00", J(10), "15:00");
    await leave(eA, J(10), "15:00", J(10), "17:00");
    expect(await day(eA, J(10))).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("đơn 15:00–20:00 (một phần ngoài ca, chỉ 120 phút trong ca) => 1 công", async () => {
    await scan(eA, J(11), "07:58");
    await scan(eA, J(11), "15:00");
    await leave(eA, J(11), "15:00", J(11), "20:00");
    expect(await day(eA, J(11))).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0 });
  });

  it("đơn PENDING + REJECTED phủ cả buổi chiều => vẫn 1 công, 0 phép", async () => {
    await scan(eA, J(13), "07:58");
    await scan(eA, J(13), "12:03");
    await leave(eA, J(13), "13:00", J(13), "17:00", "PENDING");
    await leave(eA, J(13), "13:00", J(13), "17:00", "REJECTED");
    expect(await day(eA, J(13))).toMatchObject({ workDayUnits: 1, leaveDayUnits: 0, pendingLeave: true });
  });

  it("đi trễ 08:30 + phép chiều => LATE, 0.5 + 0.5", async () => {
    await scan(eA, J(14), "08:30");
    await scan(eA, J(14), "12:03");
    await leave(eA, J(14), "13:00", J(14), "17:00");
    expect(await day(eA, J(14))).toMatchObject({ status: "LATE", workDayUnits: 0.5, leaveDayUnits: 0.5 });
  });

  it("ngày lễ không có ca: không quét = HOLIDAY 0; vắng = ABSENT 0; nghỉ phép cả ngày = 1 phép", async () => {
    expect(await day(eA, HOLIDAY)).toMatchObject({ status: "HOLIDAY", workDayUnits: 0, leaveDayUnits: 0 });
    expect(await day(eA, J(16))).toMatchObject({ status: "ABSENT", workDayUnits: 0, leaveDayUnits: 0 });
    await leave(eA, J(17), "08:00", J(17), "17:00");
    expect(await day(eA, J(17))).toMatchObject({ status: "ON_LEAVE", workDayUnits: 0, leaveDayUnits: 1 });
  });

  it("tổng tháng: báo cáo = /api/me/attendance = Excel (5.5 công, 3.5 phép)", async () => {
    const r = await monthRow(eA);
    expect(r.workDays).toBe(5.5);
    expect(r.leaveDays).toBe(3.5);
    const me = await meTotals(eA);
    expect(me.workDays).toBe(r.workDays);
    expect(me.leaveDays).toBe(r.leaveDays);
    expect(me.workMinutes).toBe(r.workMinutes);
  });
});

describe("QC ngày lễ đi làm", () => {
  it("ngày lễ có ca theo lịch đã đăng ký và đi làm => 1 công, holidayWork", async () => {
    await prisma.rosterWeek.create({ data: { departmentId: dH.id, weekStart: startOfWeek(HOLIDAY), status: "REGISTERED" } });
    await prisma.workSchedule.create({ data: { employeeId: eH.id, date: HOLIDAY, shiftId: sHC.id } });
    await scan(eH, HOLIDAY, "07:58");
    await scan(eH, HOLIDAY, "17:02");
    expect(await day(eH, HOLIDAY)).toMatchObject({ status: "ON_TIME", holidayWork: true, workDayUnits: 1, workMinutes: 480 });
  });

  it("ngày lễ không có ca (FIXED) mà vẫn đi làm => OUT_OF_SHIFT, 0 công (chỉ OT nếu có đơn)", async () => {
    await scan(eMix, HOLIDAY, "08:00");
    await scan(eMix, HOLIDAY, "12:00");
    expect(await day(eMix, HOLIDAY)).toMatchObject({ status: "OUT_OF_SHIFT", holidayWork: true, workDayUnits: 0, leaveDayUnits: 0 });
  });
});

describe("QC ca đêm có giờ nghỉ sau nửa đêm", () => {
  it("22:00–06:00 nghỉ 02:00: đủ ca = 1 công, 420 phút; phép 01:00–06:00 => 0.5 + 0.5, 180 phút", async () => {
    await scan(eNight, J(6), "21:58");
    await scan(eNight, J(7), "06:02");
    expect(await day(eNight, J(6))).toMatchObject({ status: "ON_TIME", workDayUnits: 1, workMinutes: 420 });
    await leave(eNight, J(8), "01:00", J(8), "06:00");
    await scan(eNight, J(7), "21:58");
    await scan(eNight, J(8), "01:00");
    expect(await day(eNight, J(7))).toMatchObject({ workDayUnits: 0.5, leaveDayUnits: 0.5, workMinutes: 180 });
  });
});

describe("QC hệ số công & tổng số lẻ", () => {
  it("ca T7 hệ số 0.5 (theo mẫu tuần): cả ca 0.5, nửa ca phép 0.25 + 0.25, phép cả ca 0.5; tổng tháng không sai số", async () => {
    await leave(eMix, J(11), "08:00", J(11), "12:00");
    await scan(eMix, J(18), "07:58");
    await scan(eMix, J(18), "10:00");
    await leave(eMix, J(18), "10:00", J(18), "12:00");
    for (const d of [20, 22]) {
      await scan(eMix, J(d), "07:58");
      await scan(eMix, J(d), "17:02");
    }
    await scan(eMix, J(21), "07:58");
    await scan(eMix, J(21), "12:02");
    await leave(eMix, J(21), "13:00", J(21), "17:00");
    await scan(eMix, J(25), "07:58");
    await scan(eMix, J(25), "12:02");
    expect(await day(eMix, J(11))).toMatchObject({ status: "ON_LEAVE", leaveDayUnits: 0.5 });
    expect(await day(eMix, J(18))).toMatchObject({ workDayUnits: 0.25, leaveDayUnits: 0.25 });
    expect(await day(eMix, J(25))).toMatchObject({ workDayUnits: 0.5 });
    const r = await monthRow(eMix);
    expect(r.workDays).toBe(3.25);
    expect(r.leaveDays).toBe(1.25);
    const me = await meTotals(eMix);
    expect([me.workDays, me.leaveDays]).toEqual([3.25, 1.25]);
  });

  it("Excel: Ngày công / Ngày nghỉ phép / Giờ công / Công khớp báo cáo", async () => {
    const res = await xlsxRoute.GET(req(`/api/reports/attendance.xlsx?from=${J(1)}&to=${J(31)}&departmentId=${dA.id}`, { cookie: A }), ctx());
    expect(res.status).toBe(200);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const sum = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Tổng hợp"]);
    const a = sum.find((x) => x["Mã NV"] === eA.code)!;
    const m = sum.find((x) => x["Mã NV"] === eMix.code)!;
    expect([a["Ngày công"], a["Ngày nghỉ phép"]]).toEqual([5.5, 3.5]);
    expect([m["Ngày công"], m["Ngày nghỉ phép"]]).toEqual([3.25, 1.25]);
    const rA = await monthRow(eA);
    expect(a["Giờ công"]).toBe(Math.round((rA.workMinutes / 60) * 100) / 100);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Chi tiết"]).filter((x) => x["Mã NV"] === eMix.code);
    expect(detail.find((x) => x["Ngày"] === "18/07/2026")).toMatchObject({ "Công": 0.25 });
    expect(detail.find((x) => x["Ngày"] === "21/07/2026")).toMatchObject({ "Công": 0.5, "Giờ công": 4 });
  });

  it("hệ số phòng 0.25 + nửa ngày phép (0.125/ngày): báo cáo làm tròn từng bước => 2 ngày thành 0.26 thay vì 0.25, lệch /me", async () => {
    expect((await putWeights(A, [{ departmentId: dF.id, shiftId: sHC.id, workDayValue: 0.25 }])).status).toBe(200);
    for (const d of [6, 7]) {
      await scan(eF, J(d), "07:58");
      await scan(eF, J(d), "12:02");
      await leave(eF, J(d), "13:00", J(d), "17:00");
    }
    expect(await day(eF, J(6))).toMatchObject({ workDayUnits: 0.125, leaveDayUnits: 0.125 });
    const r = await monthRow(eF);
    const me = await meTotals(eF);
    expect(me.workDays).toBe(0.25);
    expect(r.workDays).toBe(me.workDays);
    expect(r.leaveDays).toBe(me.leaveDays);
  });
});

describe("QC hệ số riêng theo phòng: chuyển phòng, xóa, hệ số 0", () => {
  it("đổi phòng (hiệu lực hôm nay): ngày đã qua theo hệ số phòng cũ, ngày tới theo phòng mới; xóa => về hệ số chung", async () => {
    expect(
      (
        await putWeights(A, [
          { departmentId: dM1.id, shiftId: sHC.id, workDayValue: 0.5 },
          { departmentId: dM2.id, shiftId: sHC.id, workDayValue: 0.75 },
        ])
      ).status,
    ).toBe(200);
    await scan(eMv, J(27), "07:58");
    await scan(eMv, J(27), "17:02");
    expect((await day(eMv, J(27))).workDayUnits).toBe(0.5);

    const res = await employeeRoute.PATCH(req(`/api/employees/${eMv.id}`, { method: "PATCH", cookie: A, body: { departmentId: dM2.id } }), ctx({ id: String(eMv.id) }));
    expect(res.status).toBe(200);
    await scan(eMv, FUT, "07:58");
    await scan(eMv, FUT, "17:02");
    expect((await day(eMv, J(27))).workDayUnits).toBe(0.5); // phòng cũ
    expect((await day(eMv, FUT)).workDayUnits).toBe(0.75); // phòng mới

    expect((await putWeights(A, [{ departmentId: dM1.id, shiftId: sHC.id, workDayValue: null }])).status).toBe(200);
    expect((await day(eMv, J(27))).workDayUnits).toBe(1);
    expect(await prisma.departmentShiftWeight.count({ where: { departmentId: dM1.id } })).toBe(0);

    expect((await putWeights(A, [{ departmentId: dM2.id, shiftId: sHC.id, workDayValue: 0 }])).status).toBe(200);
    expect((await day(eMv, FUT)).workDayUnits).toBe(0); // hệ số 0 hợp lệ, không rơi về hệ số chung
  });

  it("đặt lại cùng giá trị => changed 0, không gửi tin nhóm; xóa mục chưa có => không gửi tin", async () => {
    const before = await groupEvents();
    const r1 = await putWeights(A, [{ departmentId: dM2.id, shiftId: sHC.id, workDayValue: 0 }]);
    expect((await r1.json()).changed).toBe(0);
    const r2 = await putWeights(A, [{ departmentId: dH.id, shiftId: sHC.id, workDayValue: null }]);
    expect((await r2.json()).changed).toBe(0);
    expect(await groupEvents()).toBe(before);
  });

  it("dữ liệu sai => 400: 0.3, -1, 4, 'abc', mảng rỗng, phòng/ca không tồn tại, thiếu weights", async () => {
    const bad = [0.3, -1, 4, 3.1, "abc", 0.125];
    for (const v of bad) expect((await putWeights(A, [{ departmentId: dA.id, shiftId: sHC.id, workDayValue: v }])).status, `value ${v}`).toBe(400);
    expect((await putWeights(A, [])).status).toBe(400);
    expect((await putWeights(A, [{ departmentId: 999999, shiftId: sHC.id, workDayValue: 1 }])).status).toBe(400);
    expect((await putWeights(A, [{ departmentId: dA.id, shiftId: 999999, workDayValue: 1 }])).status).toBe(400);
    expect((await putWeights(A, [{ departmentId: dA.id, shiftId: sHC.id }])).status).toBe(400);
    expect((await weightsRoute.PUT(req("/api/shift-weights", { method: "PUT", cookie: A, body: {} }), ctx())).status).toBe(400);
    expect(await prisma.departmentShiftWeight.count({ where: { departmentId: dA.id } })).toBe(0);
  });

  it("workDayValue = \"\" (ô nhập trống) bị ép thành 0 và được lưu, thay vì 400", async () => {
    const res = await putWeights(A, [{ departmentId: dA.id, shiftId: sHC.id, workDayValue: "" }]);
    await prisma.departmentShiftWeight.deleteMany({ where: { departmentId: dA.id } });
    expect(res.status).toBe(400);
  });

  it("phân quyền: HR / MANAGER / EMPLOYEE => 403 cho GET và PUT; ADMIN GET thấy hệ số", async () => {
    for (const c of [H, M, E]) {
      expect((await getWeights(c)).status).toBe(403);
      expect((await putWeights(c, [{ departmentId: dA.id, shiftId: sHC.id, workDayValue: 1 }])).status).toBe(403);
      expect((await patchShift(c, sHC.id, { workDayValue: 0.5 })).status).toBe(403);
    }
    const res = await getWeights(A);
    expect(res.status).toBe(200);
    const { weights } = (await res.json()) as { weights: { departmentId: number; shiftId: number; workDayValue: number }[] };
    expect(weights).toContainEqual({ departmentId: dF.id, shiftId: sHC.id, workDayValue: 0.25 });
    expect(await prisma.departmentShiftWeight.count({ where: { departmentId: dA.id } })).toBe(0);
  });
});

describe("QC sửa ca: giờ nghỉ & tin nhóm", () => {
  it("breakStart ngoài ca => 400 (sau giờ ra, trước giờ vào, đổi giờ vào làm giờ nghỉ lọt ra ngoài, ca đêm 05:30)", async () => {
    expect((await patchShift(A, sHC.id, { breakStart: "16:30" })).status).toBe(400);
    expect((await patchShift(A, sHC.id, { breakStart: "07:00" })).status).toBe(400);
    expect((await patchShift(A, sHC.id, { startTime: "12:30" })).status).toBe(400);
    expect((await patchShift(A, sHC.id, { breakMinutes: 400 })).status).toBe(400);
    expect((await patchShift(A, sNight.id, { breakStart: "05:30" })).status).toBe(400);
    expect((await patchShift(A, sNight.id, { breakStart: "21:00" })).status).toBe(400);
    expect((await patchShift(A, sNight.id, { breakStart: "25:00" })).status).toBe(400);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: sHC.id } })).breakStart).toBe("12:00");
  });

  it("breakStart null => xóa, giờ công quay về trừ đủ; khôi phục 12:00", async () => {
    expect((await patchShift(A, sHC.id, { breakStart: null })).status).toBe(200);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: sHC.id } })).breakStart).toBeNull();
    expect((await day(eA, J(7))).workMinutes).toBe(182); // không khai giờ nghỉ: kẹp trong ca (12:58–17:00) rồi trừ đủ 60
    expect((await patchShift(A, sHC.id, { breakStart: "12:00" })).status).toBe(200);
    expect((await day(eA, J(7))).workMinutes).toBe(240);
  });

  it("tin nhóm GROUP_EVENT chỉ khi hệ số thực sự đổi", async () => {
    let n = await groupEvents();
    expect((await patchShift(A, sHalf.id, { workDayValue: 0.5 })).status).toBe(200);
    expect((await patchShift(A, sHalf.id, { workDayValue: "0.5" })).status).toBe(200);
    expect((await patchShift(A, sHalf.id, { graceLateMinutes: 6 })).status).toBe(200);
    expect(await groupEvents()).toBe(n);
    expect((await patchShift(A, sHalf.id, { workDayValue: 0.75 })).status).toBe(200);
    expect(await groupEvents()).toBe(++n);
    expect((await day(eMix, J(25))).workDayUnits).toBe(0.75);
    expect((await patchShift(A, sHalf.id, { workDayValue: 0.5 })).status).toBe(200);
    expect(await groupEvents()).toBe(++n);
    expect((await patchShift(A, sHalf.id, { workDayValue: 0.3 })).status).toBe(400);
    expect((await patchShift(A, sHalf.id, { workDayValue: 3.25 })).status).toBe(400);
  });

  it("PATCH ca với workDayValue = null (hoặc \"\") bị ép thành 0 — ca âm thầm thành 0 công", async () => {
    const r1 = await patchShift(A, sHalf.id, { workDayValue: null });
    const after1 = (await prisma.shift.findUniqueOrThrow({ where: { id: sHalf.id } })).workDayValue;
    await prisma.shift.update({ where: { id: sHalf.id }, data: { workDayValue: 0.5 } });
    const r2 = await patchShift(A, sHalf.id, { workDayValue: "" });
    const after2 = (await prisma.shift.findUniqueOrThrow({ where: { id: sHalf.id } })).workDayValue;
    await prisma.shift.update({ where: { id: sHalf.id }, data: { workDayValue: 0.5 } });
    expect([r1.status, after1]).toEqual([400, 0.5]);
    expect([r2.status, after2]).toEqual([400, 0.5]);
  });
});
