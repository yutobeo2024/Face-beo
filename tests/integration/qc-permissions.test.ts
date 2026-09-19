// QC adversarial tests — Giai đoạn 1 (HR + ma trận phân quyền).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEFAULT_MATRIX, getMatrix, invalidatePermissionCache } from "@/lib/permissions";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as settingsRoute from "@/app/api/settings/route";
import * as devicesRoute from "@/app/api/devices/route";
import * as permissionsRoute from "@/app/api/permissions/route";
import * as manualRoute from "@/app/api/attendance/manual/route";
import * as attIdRoute from "@/app/api/attendance/[id]/route";
import * as suspiciousRoute from "@/app/api/attendance/suspicious/route";
import * as shiftsRoute from "@/app/api/shifts/route";
import * as shiftIdRoute from "@/app/api/shifts/[id]/route";
import * as holidaysRoute from "@/app/api/holidays/route";
import * as holidayDateRoute from "@/app/api/holidays/[date]/route";
import * as departmentsRoute from "@/app/api/departments/route";
import * as departmentIdRoute from "@/app/api/departments/[id]/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as consentRoute from "@/app/api/employees/[id]/consent/route";
import * as facesRoute from "@/app/api/employees/[id]/faces/route";
import * as snapshotsRoute from "@/app/api/snapshots/[...path]/route";
import * as summaryRoute from "@/app/api/reports/summary/route";
import * as rosterRoute from "@/app/api/roster/route";
import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgrKD: E, mgrKT: E, empKD: E, empKT: E;
let A: string, H: string, MKD: string, EKD: string;

const defaults = () => JSON.parse(JSON.stringify(DEFAULT_MATRIX)) as Record<string, string[]>;
const putMatrix = (cookie: string, body: unknown) => permissionsRoute.PUT(req("/api/permissions", { method: "PUT", cookie, body }), ctx());
const reset = () => putMatrix(A, { matrix: defaults(), reason: "QC reset mặc định" });
const grant = (role: string, ...caps: string[]) => {
  const m = defaults();
  m[role] = [...m[role], ...caps];
  return putMatrix(A, { matrix: m, reason: "QC cấp quyền thử" });
};
const groupCount = () => prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });

beforeAll(async () => {
  admin = await byCode("NV001");
  mgrKD = await byCode("NV003");
  mgrKT = await byCode("NV004");
  empKD = await byCode("NV008");
  empKT = await byCode("NV009");
  hr = await byCode("NV016");
  A = await sessionCookie(admin.id);
  H = await sessionCookie(hr.id);
  MKD = await sessionCookie(mgrKD.id);
  EKD = await sessionCookie(empKD.id);
  await reset();
});
afterEach(async () => {
  await reset();
});
afterAll(async () => {
  await reset();
});

describe("QC-1 API chỉ Quản trị: EMPLOYEE / MANAGER / HR đều 403", () => {
  it("settings, devices, permissions, manual, delete log, suspicious, shifts, holidays, departments", async () => {
    const shift = await prisma.shift.findFirstOrThrow();
    const dep = await prisma.department.findFirstOrThrow();
    const log = await prisma.attendanceLog.findFirst();
    const d = addDays(todayVN(), 200);
    for (const [who, c] of [["EMPLOYEE", EKD], ["MANAGER", MKD], ["HR", H]] as const) {
      const calls: [string, Promise<Response>][] = [
        ["settings GET", settingsRoute.GET(req("/api/settings", { cookie: c }), ctx())],
        ["settings PUT", settingsRoute.PUT(req("/api/settings", { method: "PUT", cookie: c, body: { matchThreshold: 0.1 } }), ctx())],
        ["devices GET", devicesRoute.GET(req("/api/devices", { cookie: c }), ctx())],
        ["devices POST", devicesRoute.POST(req("/api/devices", { method: "POST", cookie: c, body: { name: "x" } }), ctx())],
        ["permissions GET", permissionsRoute.GET(req("/api/permissions", { cookie: c }), ctx())],
        ["permissions PUT", putMatrix(c, { matrix: defaults(), reason: "leo thang quyền" })],
        ["manual", manualRoute.POST(req("/api/attendance/manual", { method: "POST", cookie: c, body: { employeeId: empKD.id, checkTime: new Date().toISOString(), reason: "thử chấm tay" } }), ctx())],
        ["att DELETE", attIdRoute.DELETE(req(`/api/attendance/${log?.id ?? 1}`, { method: "DELETE", cookie: c, body: { reason: "xóa thử log" } }), ctx({ id: String(log?.id ?? 1) }))],
        ["suspicious", suspiciousRoute.GET(req("/api/attendance/suspicious", { cookie: c }), ctx())],
        ["shifts POST", shiftsRoute.POST(req("/api/shifts", { method: "POST", cookie: c, body: { name: "Ca QC", startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 0, graceEarlyMinutes: 0 } }), ctx())],
        ["shifts PATCH", shiftIdRoute.PATCH(req(`/api/shifts/${shift.id}`, { method: "PATCH", cookie: c, body: { name: "Đổi tên" } }), ctx({ id: String(shift.id) }))],
        ["holidays POST", holidaysRoute.POST(req("/api/holidays", { method: "POST", cookie: c, body: { date: d, name: "Lễ QC" } }), ctx())],
        ["holidays DELETE", holidayDateRoute.DELETE(req(`/api/holidays/${d}`, { method: "DELETE", cookie: c }), ctx({ date: d }))],
        ["departments POST", departmentsRoute.POST(req("/api/departments", { method: "POST", cookie: c, body: { name: "Phòng QC" } }), ctx())],
        ["departments PATCH", departmentIdRoute.PATCH(req(`/api/departments/${dep.id}`, { method: "PATCH", cookie: c, body: { name: "Đổi tên phòng" } }), ctx({ id: String(dep.id) }))],
      ];
      for (const [name, p] of calls) expect({ who, name, status: (await p).status }).toEqual({ who, name, status: 403 });
    }
  });
});

describe("QC-2 HR leo thang", () => {
  const patch = (cookie: string, id: number, body: object) =>
    employeeRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));

  it("HR không tạo/gán HR-ADMIN, không sửa/khóa/reset ADMIN hay HR khác", async () => {
    const shift = await prisma.shift.findFirstOrThrow();
    const mk = (role: string, i: number) =>
      employeesRoute.POST(req("/api/employees", { method: "POST", cookie: H, body: { code: `QCX${i}`, name: "QC test", phone: `0977000${100 + i}`, role, departmentId: empKD.departmentId, defaultShiftId: shift.id } }), ctx());
    expect((await mk("ADMIN", 1)).status).toBe(403);
    expect((await mk("HR", 2)).status).toBe(403);
    expect((await patch(H, empKD.id, { role: "ADMIN" })).status).toBe(403);
    expect((await patch(H, mgrKD.id, { role: "HR" })).status).toBe(403);
    expect((await patch(H, admin.id, { resetPassword: true })).status).toBe(403);
    expect((await patch(H, admin.id, { active: false })).status).toBe(403);
    expect((await patch(H, admin.id, { role: "EMPLOYEE" })).status).toBe(403);
    expect((await patch(H, hr.id, { active: false })).status).toBe(400);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });

  it("HR không tự gán mình làm quản lý phòng (thiếu org.manage)", async () => {
    const res = await departmentIdRoute.PATCH(
      req(`/api/departments/${empKT.departmentId}`, { method: "PATCH", cookie: H, body: { managerId: hr.id } }),
      ctx({ id: String(empKT.departmentId) }),
    );
    expect(res.status).toBe(403);
  });

  it("[BUG?] HR không được ghi đồng ý sinh trắc / xóa khuôn mặt của tài khoản Quản trị", async () => {
    const consent = await consentRoute.POST(req(`/api/employees/${admin.id}/consent`, { method: "POST", cookie: H }), ctx({ id: String(admin.id) }));
    const delFaces = await facesRoute.DELETE(req(`/api/employees/${admin.id}/faces`, { method: "DELETE", cookie: H }), ctx({ id: String(admin.id) }));
    const withdraw = await consentRoute.DELETE(req(`/api/employees/${admin.id}/consent`, { method: "DELETE", cookie: H }), ctx({ id: String(admin.id) }));
    expect({ consent: consent.status, delFaces: delFaces.status, withdraw: withdraw.status }).toEqual({ consent: 403, delFaces: 403, withdraw: 403 });
  });
});

describe("QC-3 MANAGER ngoài phạm vi phòng", () => {
  it("không xem hồ sơ / báo cáo / roster phòng khác, không duyệt đơn phòng khác", async () => {
    expect((await employeeRoute.GET(req(`/api/employees/${empKT.id}`, { cookie: MKD }), ctx({ id: String(empKT.id) }))).status).toBe(403);
    expect((await employeeRoute.GET(req(`/api/employees/${empKT.id}`, { cookie: EKD }), ctx({ id: String(empKT.id) }))).status).toBe(403);
    const from = addDays(todayVN(), -7);
    const rep = await (await summaryRoute.GET(req(`/api/reports/summary?from=${from}&to=${todayVN()}&departmentId=${empKT.departmentId}`, { cookie: MKD }), ctx())).json();
    expect(JSON.stringify(rep)).not.toContain(empKT.code);
    const put = await rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie: MKD, body: { cells: [{ employeeId: empKD.id, date: addDays(todayVN(), 14), shiftId: null, isDayOff: true }, { employeeId: empKT.id, date: addDays(todayVN(), 14), shiftId: null, isDayOff: true }] } }), ctx());
    expect(put.status).toBe(403);
    expect(await prisma.workSchedule.count({ where: { employeeId: { in: [empKD.id, empKT.id] }, date: addDays(todayVN(), 14) } })).toBe(0);
    const day = addDays(todayVN(), 20);
    const r = await prisma.leaveRequest.create({ data: { employeeId: empKT.id, type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00"), toTime: vnDateTime(day, "17:00"), reason: "QC xin nghỉ phép một ngày" } });
    expect((await decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", cookie: MKD, body: { action: "APPROVE" } }), ctx({ id: String(r.id) }))).status).toBe(403);
    expect((await decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", cookie: EKD, body: { action: "APPROVE" } }), ctx({ id: String(r.id) }))).status).toBe(403);
  });

  it("snapshot của phòng khác bị chặn", async () => {
    const url = "/api/snapshots/2026/01/01/00000000-0000-0000-0000-00000000qc01.jpg".replace("qc01", "0c01");
    await prisma.attendanceLog.create({ data: { employeeId: empKT.id, workDate: "2026-01-01", checkTime: new Date("2026-01-01T01:00:00Z"), type: "IN", snapshotUrl: url, source: "KIOSK" } });
    const parts = url.replace("/api/snapshots/", "").split("/");
    expect((await snapshotsRoute.GET(req(url, { cookie: MKD }), ctx({ path: parts }))).status).toBe(403);
    expect((await snapshotsRoute.GET(req(url, { cookie: EKD }), ctx({ path: parts }))).status).toBe(403);
  });

  it("[BUG] cấp attendance.manualDirect cho MANAGER: vẫn phải giới hạn phòng mình", async () => {
    expect((await grant("MANAGER", "attendance.manualDirect")).status).toBe(200);
    const res = await manualRoute.POST(req("/api/attendance/manual", { method: "POST", cookie: MKD, body: { employeeId: empKT.id, checkTime: vnDateTime(addDays(todayVN(), -1), "08:00").toISOString(), reason: "chấm hộ phòng khác" } }), ctx());
    expect(res.status).toBe(403);
  });

  it("[BUG] cấp attendance.delete cho MANAGER: không được xóa log phòng khác", async () => {
    const log = await prisma.attendanceLog.create({ data: { employeeId: empKT.id, workDate: "2026-01-02", checkTime: new Date("2026-01-02T01:00:00Z"), type: "IN", source: "MANUAL" } });
    await grant("MANAGER", "attendance.delete");
    const res = await attIdRoute.DELETE(req(`/api/attendance/${log.id}`, { method: "DELETE", cookie: MKD, body: { reason: "xóa log phòng khác" } }), ctx({ id: String(log.id) }));
    expect(res.status).toBe(403);
  });

  it("[BUG] cấp org.manage cho MANAGER: không được tự gán mình quản lý phòng khác (mở rộng phạm vi)", async () => {
    await grant("MANAGER", "org.manage");
    const res = await departmentIdRoute.PATCH(req(`/api/departments/${empKT.departmentId}`, { method: "PATCH", cookie: MKD, body: { managerId: mgrKD.id } }), ctx({ id: String(empKT.departmentId) }));
    const status = res.status;
    await prisma.department.update({ where: { id: empKT.departmentId }, data: { managerId: mgrKT.id } });
    expect(status).toBe(403);
  });

  it("[BUG] cấp org.manage cho EMPLOYEE: tự gán mình quản lý phòng => tự lên MANAGER", async () => {
    await grant("EMPLOYEE", "org.manage");
    const res = await departmentIdRoute.PATCH(req(`/api/departments/${empKD.departmentId}`, { method: "PATCH", cookie: EKD, body: { managerId: empKD.id } }), ctx({ id: String(empKD.departmentId) }));
    const role = (await prisma.employee.findUniqueOrThrow({ where: { id: empKD.id } })).role;
    await prisma.employee.update({ where: { id: empKD.id }, data: { role: "EMPLOYEE" } });
    await prisma.department.update({ where: { id: empKD.departmentId }, data: { managerId: mgrKD.id } });
    expect({ status: res.status, role }).toEqual({ status: 403, role: "EMPLOYEE" });
  });
});

describe("QC-4 lạm dụng API ma trận", () => {
  it("từ chối locked cap, hàng ADMIN, vai trò lạ, thiếu/ngắn lý do, sai kiểu", async () => {
    const bad = [
      { matrix: { ...defaults(), MANAGER: ["permissions.manage"] }, reason: "hợp lệ đủ dài" },
      { matrix: { ...defaults(), EMPLOYEE: ["devices.manage"] }, reason: "hợp lệ đủ dài" },
      { matrix: { ADMIN: ["dashboard.view"] }, reason: "hợp lệ đủ dài" },
      { matrix: { SUPERUSER: [] }, reason: "hợp lệ đủ dài" },
      { matrix: { __proto__x: [] }, reason: "hợp lệ đủ dài" },
      { matrix: { hr: ["dashboard.view"] }, reason: "hợp lệ đủ dài" },
      { matrix: defaults() },
      { matrix: defaults(), reason: "     " },
      { matrix: defaults(), reason: "x".repeat(301) },
      { matrix: { HR: "dashboard.view" }, reason: "hợp lệ đủ dài" },
    ];
    for (const b of bad) expect((await putMatrix(A, b)).status).toBe(400);
    const raw = await permissionsRoute.PUT(
      req("/api/permissions", { method: "PUT", cookie: A, headers: { "content-type": "application/json" } }),
      ctx(),
    );
    expect(raw.status).toBe(400);
    invalidatePermissionCache();
    const m = await getMatrix();
    expect([...m.HR].sort()).toEqual([...DEFAULT_MATRIX.HR].sort());
  });

  it("payload lớn (50k phần tử trùng) không làm hỏng/nhân bản dòng", async () => {
    const m = defaults();
    m.EMPLOYEE = Array(50_000).fill("dashboard.view");
    expect((await putMatrix(A, { matrix: m, reason: "payload lớn QC" })).status).toBe(200);
    expect(await prisma.rolePermission.count({ where: { role: "EMPLOYEE" } })).toBe(1);
  });

  it("[RISK] gửi ma trận thiếu vai trò không được âm thầm xóa sạch quyền vai trò còn lại", async () => {
    const res = await putMatrix(A, { matrix: { HR: DEFAULT_MATRIX.HR }, reason: "chỉ sửa hàng HR" });
    invalidatePermissionCache();
    const mgrCaps = (await getMatrix()).MANAGER.size;
    expect({ status: res.status, mgrCaps: res.status === 200 ? mgrCaps : DEFAULT_MATRIX.MANAGER.length }).toEqual({ status: res.status, mgrCaps: DEFAULT_MATRIX.MANAGER.length });
  });

  it("dữ liệu rác trong DB (quyền khóa cứng) bị bỏ qua khi nạp", async () => {
    await prisma.rolePermission.create({ data: { role: "HR", capability: "settings.system" } });
    invalidatePermissionCache();
    expect((await settingsRoute.GET(req("/api/settings", { cookie: H }), ctx())).status).toBe(403);
  });
});

describe("QC-5 announce không bắn cho thao tác tự phục vụ", () => {
  it("nhân viên / HR / quản lý tự tạo đơn, quản lý duyệt => không có GROUP_EVENT", async () => {
    const before = await groupCount();
    const mk = (cookie: string, d: number) => {
      const day = addDays(todayVN(), d);
      return requestsRoute.POST(req("/api/requests", { method: "POST", cookie, body: { type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00").toISOString(), toTime: vnDateTime(day, "17:00").toISOString(), reason: "QC tự tạo đơn nghỉ phép" } }), ctx());
    };
    const r1 = await mk(EKD, 30);
    expect(r1.status).toBe(201);
    expect((await mk(H, 31)).status).toBe(201);
    expect((await mk(MKD, 32)).status).toBe(201);
    const id = (await r1.json()).request.id;
    expect((await decideRoute.POST(req(`/api/requests/${id}/decide`, { method: "POST", cookie: MKD, body: { action: "APPROVE" } }), ctx({ id: String(id) }))).status).toBe(200);
    // Nhân viên tự rút đồng ý sinh trắc
    await consentRoute.DELETE(req(`/api/employees/${empKD.id}/consent`, { method: "DELETE", cookie: EKD }), ctx({ id: String(empKD.id) }));
    expect(await groupCount()).toBe(before);
  });

  it("thao tác bị từ chối (403) không để lại GROUP_EVENT", async () => {
    const before = await groupCount();
    await employeeRoute.PATCH(req(`/api/employees/${admin.id}`, { method: "PATCH", cookie: H, body: { resetPassword: true } }), ctx({ id: String(admin.id) }));
    await putMatrix(H, { matrix: defaults(), reason: "leo thang quyền" });
    expect(await groupCount()).toBe(before);
  });
});
