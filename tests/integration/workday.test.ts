import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { buildAttendanceReport } from "@/lib/reports";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as shiftRoute from "@/app/api/shifts/[id]/route";
import * as weightsRoute from "@/app/api/shift-weights/route";
import * as xlsxRoute from "@/app/api/reports/attendance.xlsx/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, emp: E;
let A: string, H: string;
let satAm: { id: number; workDayValue: number };
let hc: { id: number };
let SAT: string;
let MON: string;

const patchShift = (cookie: string, id: number, body: object) => shiftRoute.PATCH(req(`/api/shifts/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
const putWeights = (cookie: string, weights: object[]) => weightsRoute.PUT(req("/api/shift-weights", { method: "PUT", cookie, body: { weights } }), ctx());
const scan = (e: E, d: string, t: string) => recordScan({ employeeId: e.id, checkTime: vnDateTime(d, t), source: "MANUAL", createdById: admin.id });
const row = async (d: string) => (await buildAttendanceReport({ id: emp.id }, d, d)).summary[0];

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  emp = await byCode("NV007"); // cố định, mẫu "HC T2–T6 + T7 sáng", phòng Hành chính
  [A, H] = await Promise.all([admin, hr].map((e) => sessionCookie(e.id)));
  satAm = await prisma.shift.findUniqueOrThrow({ where: { name: "Sáng thứ Bảy" } });
  hc = await prisma.shift.findUniqueOrThrow({ where: { name: "Hành chính" } });
  // Thứ Bảy & thứ Hai của 3 tuần trước (tránh ngày các file test khác dùng).
  const base = addDays(startOfWeek(todayVN()), -21);
  MON = base;
  SAT = addDays(base, 5);
  expect(weekday(SAT)).toBe(6);
  await prisma.attendanceLog.deleteMany({ where: { employeeId: emp.id, workDate: { in: [SAT, MON] } } });
  await scan(emp, SAT, "07:58");
  await scan(emp, SAT, "12:03");
});

afterAll(async () => {
  await prisma.shift.update({ where: { id: satAm.id }, data: { workDayValue: 1 } });
  await prisma.departmentShiftWeight.deleteMany();
});

describe("hệ số công theo ca / phòng", () => {
  it("mặc định hệ số = 1: T7 sáng vẫn tính 1 công (không tự đổi khi triển khai)", async () => {
    expect((await row(SAT)).workDays).toBe(1);
  });

  it("Quản trị đặt hệ số chung ca Sáng thứ Bảy = 0.5 => 0.5 công; có tin nhóm Zalo", async () => {
    const before = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    expect((await patchShift(A, satAm.id, { workDayValue: 0.5 })).status).toBe(200);
    expect((await row(SAT)).workDays).toBe(0.5);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(before + 1);
  });

  it("hệ số riêng của phòng ghi đè hệ số chung; xóa thì quay về hệ số chung", async () => {
    const res = await putWeights(A, [{ departmentId: emp.departmentId, shiftId: satAm.id, workDayValue: 1 }]);
    expect(res.status).toBe(200);
    expect((await row(SAT)).workDays).toBe(1);
    expect((await putWeights(A, [{ departmentId: emp.departmentId, shiftId: satAm.id, workDayValue: null }])).status).toBe(200);
    expect((await row(SAT)).workDays).toBe(0.5);
  });

  it("chỉ org.manage (Quản trị) được sửa; dữ liệu sai => 400", async () => {
    expect((await putWeights(H, [{ departmentId: emp.departmentId, shiftId: satAm.id, workDayValue: 1 }])).status).toBe(403);
    expect((await patchShift(H, satAm.id, { workDayValue: 1 })).status).toBe(403);
    expect((await putWeights(A, [{ departmentId: emp.departmentId, shiftId: satAm.id, workDayValue: 0.3 }])).status).toBe(400);
    expect((await putWeights(A, [{ departmentId: 99999, shiftId: satAm.id, workDayValue: 1 }])).status).toBe(400);
    expect((await patchShift(A, hc.id, { breakStart: "16:30" })).status).toBe(400); // nghỉ vượt quá giờ ra ca
  });
});

describe("nửa ngày phép & giờ công (D1)", () => {
  it("làm sáng + nghỉ phép chiều đã duyệt = 0.5 công + 0.5 phép; giờ công không bị trừ giờ nghỉ", async () => {
    await scan(emp, MON, "07:57");
    await scan(emp, MON, "12:02");
    await prisma.leaveRequest.create({
      data: { employeeId: emp.id, type: "NGHI_PHEP", status: "APPROVED", fromTime: vnDateTime(MON, "13:00"), toTime: vnDateTime(MON, "17:00"), reason: "Việc gia đình buổi chiều" },
    });
    const r = await row(MON);
    expect(r.workDays).toBe(0.5);
    expect(r.leaveDays).toBe(0.5);
    expect(r.workMinutes).toBe(240); // 08:00–12:00 (kẹp trong ca), nghỉ 12–13 không có mặt => không trừ
  });

  it("Excel có số lẻ ở Ngày công / Ngày phép và cột Công, Giờ công", async () => {
    const res = await xlsxRoute.GET(req(`/api/reports/attendance.xlsx?from=${MON}&to=${SAT}&departmentId=${emp.departmentId}`, { cookie: A }), ctx());
    expect(res.status).toBe(200);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Tổng hợp"]).find((x) => x["Mã NV"] === emp.code)!;
    expect(summary["Ngày công"]).toBe(0.5 + 0.5); // thứ Hai 0.5 + thứ Bảy 0.5 (+ các ngày khác không có log trong seed)
    expect(summary["Ngày phép"] ?? summary["Ngày nghỉ phép"]).toBe(0.5);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Chi tiết"]).filter((x) => x["Mã NV"] === emp.code);
    expect(detail.find((x) => x["Ngày"] === MON.split("-").reverse().join("/"))).toMatchObject({ "Công": 0.5, "Giờ công": 4 });
  });
});
