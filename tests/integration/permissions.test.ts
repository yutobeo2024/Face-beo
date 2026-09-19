import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEFAULT_MATRIX, invalidatePermissionCache } from "@/lib/permissions";
import { approversFor } from "@/lib/notify";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as dashboardRoute from "@/app/api/dashboard/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as devicesRoute from "@/app/api/devices/route";
import * as permissionsRoute from "@/app/api/permissions/route";
import * as summaryRoute from "@/app/api/reports/summary/route";
import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, managerKD: E, managerKT: E, employee: E;
let adminCookie: string, hrCookie: string;

const putMatrix = (cookie: string, matrix: Record<string, string[]>, reason = "Kiểm thử phân quyền") =>
  permissionsRoute.PUT(req("/api/permissions", { method: "PUT", cookie, body: { matrix, reason } }), ctx());
const defaults = () => JSON.parse(JSON.stringify(DEFAULT_MATRIX)) as Record<string, string[]>;

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  managerKD = await byCode("NV003");
  managerKT = await byCode("NV004");
  employee = await byCode("NV008");
  adminCookie = await sessionCookie(admin.id);
  hrCookie = await sessionCookie(hr.id);
  await putMatrix(adminCookie, defaults(), "Khôi phục mặc định trước test");
});

afterAll(async () => {
  await putMatrix(adminCookie, defaults(), "Khôi phục mặc định sau test");
});

describe("vai trò Nhân sự (ma trận mặc định)", () => {
  it("HR vào được dashboard, nhân viên, báo cáo toàn công ty", async () => {
    expect((await dashboardRoute.GET(req("/api/dashboard", { cookie: hrCookie }), ctx())).status).toBe(200);
    const list = await (await employeesRoute.GET(req("/api/employees", { cookie: hrCookie }), ctx())).json();
    const depts = new Set(list.employees.map((e: { departmentId: number }) => e.departmentId));
    expect(depts.size).toBeGreaterThan(1);
    const from = addDays(todayVN(), -7);
    expect((await summaryRoute.GET(req(`/api/reports/summary?from=${from}&to=${todayVN()}`, { cookie: hrCookie }), ctx())).status).toBe(200);
  });

  it("HR KHÔNG vào được cấu hình hệ thống, thiết bị, phân quyền", async () => {
    expect((await settingsRoute.GET(req("/api/settings", { cookie: hrCookie }), ctx())).status).toBe(403);
    expect((await devicesRoute.GET(req("/api/devices", { cookie: hrCookie }), ctx())).status).toBe(403);
    expect((await permissionsRoute.GET(req("/api/permissions", { cookie: hrCookie }), ctx())).status).toBe(403);
    expect((await putMatrix(hrCookie, defaults())).status).toBe(403);
  });
});

describe("chống leo thang quyền", () => {
  const base = { name: "Nhân viên thử", departmentId: 0, defaultShiftId: 0 };
  let n = 0;
  const create = async (cookie: string, role: string) => {
    n++;
    const dep = await prisma.department.findFirstOrThrow();
    const shift = await prisma.shift.findFirstOrThrow();
    return employeesRoute.POST(
      req("/api/employees", {
        method: "POST",
        cookie,
        body: { ...base, code: `TST${Date.now() % 100000}${n}`, phone: `09${String(Date.now()).slice(-8)}`, role, departmentId: dep.id, defaultShiftId: shift.id },
      }),
      ctx(),
    );
  };

  it("HR tạo được Nhân viên/Quản lý nhưng không tạo được Nhân sự/Quản trị", async () => {
    expect((await create(hrCookie, "EMPLOYEE")).status).toBe(201);
    expect((await create(hrCookie, "HR")).status).toBe(403);
    expect((await create(hrCookie, "ADMIN")).status).toBe(403);
    expect((await create(adminCookie, "HR")).status).toBe(201);
  });

  it("HR không sửa được tài khoản Quản trị, không tự đổi vai trò của mình", async () => {
    const patch = (cookie: string, id: number, body: object) =>
      employeeRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
    expect((await patch(hrCookie, admin.id, { resetPassword: true })).status).toBe(403);
    expect((await patch(hrCookie, hr.id, { role: "ADMIN" })).status).toBe(400);
    expect((await patch(hrCookie, employee.id, { role: "HR" })).status).toBe(403);
    expect((await patch(adminCookie, admin.id, { role: "EMPLOYEE" })).status).toBe(400);
    // HR sửa được hồ sơ nhân viên thường và việc đó được gửi vào nhóm Zalo
    const before = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    expect((await patch(hrCookie, employee.id, { name: employee.name })).status).toBe(200);
    expect((await patch(hrCookie, employee.id, { unlinkZalo: true })).status).toBe(200);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(before + 1);
  });
});

describe("ma trận phân quyền chỉnh trên web", () => {
  it("Quản trị tắt quyền báo cáo của HR thì có hiệu lực ngay; bật lại cũng vậy", async () => {
    const m = defaults();
    m.HR = m.HR.filter((c) => c !== "reports.view");
    const res = await putMatrix(adminCookie, m);
    expect(res.status).toBe(200);
    const from = addDays(todayVN(), -3);
    const url = `/api/reports/summary?from=${from}&to=${todayVN()}`;
    expect((await summaryRoute.GET(req(url, { cookie: hrCookie }), ctx())).status).toBe(403);
    await putMatrix(adminCookie, defaults());
    expect((await summaryRoute.GET(req(url, { cookie: hrCookie }), ctx())).status).toBe(200);
  });

  it("từ chối quyền khóa cứng, hàng Quản trị và quyền lạ", async () => {
    expect((await putMatrix(adminCookie, { ...defaults(), HR: [...DEFAULT_MATRIX.HR, "settings.system"] })).status).toBe(400);
    expect((await putMatrix(adminCookie, { ...defaults(), HR: [...DEFAULT_MATRIX.HR, "roles.assignPrivileged"] })).status).toBe(400);
    expect((await putMatrix(adminCookie, { ...defaults(), ADMIN: [] })).status).toBe(400);
    expect((await putMatrix(adminCookie, { ...defaults(), HR: ["khong.ton.tai"] })).status).toBe(400);
  });

  it("lưu ma trận ghi AuditLog và gửi tin vào nhóm Zalo; bắt buộc có lý do", async () => {
    const audits = await prisma.auditLog.count({ where: { action: "PERMISSION_CHANGE" } });
    const groups = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    const m = defaults();
    m.MANAGER = [...m.MANAGER, "faces.enroll"];
    expect((await putMatrix(adminCookie, m)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "PERMISSION_CHANGE" } })).toBe(audits + 1);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(groups + 1);
    expect((await putMatrix(adminCookie, defaults(), "ab")).status).toBe(400);
    await putMatrix(adminCookie, defaults());
  });

  it("bỏ hết quyền của một vai trò thì không bị tự khôi phục mặc định", async () => {
    const m = defaults();
    m.MANAGER = [];
    await putMatrix(adminCookie, m);
    invalidatePermissionCache();
    const cookie = await sessionCookie(managerKD.id);
    expect((await dashboardRoute.GET(req("/api/dashboard", { cookie }), ctx())).status).toBe(403);
    await putMatrix(adminCookie, defaults());
    expect((await dashboardRoute.GET(req("/api/dashboard", { cookie }), ctx())).status).toBe(200);
  });

  it("Quản lý được cấp quyền quản lý nhân viên vẫn chỉ trong phạm vi phòng mình", async () => {
    const m = defaults();
    m.MANAGER = [...m.MANAGER, "employees.manage"];
    await putMatrix(adminCookie, m);
    const cookie = await sessionCookie(managerKD.id);
    const other = await byCode("NV009"); // Kỹ thuật
    const own = await byCode("NV015"); // Kinh doanh
    const patch = (id: number) => employeeRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie, body: { name: "Tên mới thử" } }), ctx({ id: String(id) }));
    expect((await patch(other.id)).status).toBe(403);
    expect((await patch(own.id)).status).toBe(200);
    await prisma.employee.update({ where: { id: own.id }, data: { name: own.name } });
    await putMatrix(adminCookie, defaults());
  });
});

describe("tuyến duyệt đơn theo vai trò người tạo", () => {
  it("Nhân viên → quản lý phòng; Quản lý → Nhân sự; Nhân sự → Quản trị", async () => {
    expect(await approversFor(employee.id)).toEqual([managerKD.id]);
    const forManager = await approversFor(managerKT.id);
    expect(forManager).toContain(hr.id);
    expect(forManager).not.toContain(admin.id);
    expect(await approversFor(hr.id)).toEqual([admin.id]);
  });

  it("HR duyệt đơn của Quản lý, Quản lý phòng khác không duyệt được; thao tác HR vào nhóm Zalo", async () => {
    const day = addDays(todayVN(), 9);
    const r = await prisma.leaveRequest.create({
      data: { employeeId: managerKT.id, type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00"), toTime: vnDateTime(day, "17:00"), reason: "Quản lý xin nghỉ phép một ngày" },
    });
    const decide = (cookie: string) =>
      decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", cookie, body: { action: "APPROVE" } }), ctx({ id: String(r.id) }));
    expect((await decide(await sessionCookie(managerKD.id))).status).toBe(403);
    const list = await (await requestsRoute.GET(req("/api/requests?scope=team&status=PENDING", { cookie: hrCookie }), ctx())).json();
    expect(list.requests.find((x: { id: number }) => x.id === r.id)?.canDecide).toBe(true);
    const before = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    expect((await decide(hrCookie)).status).toBe(200);
    const g = await prisma.notificationLog.findFirst({ where: { dedupeKey: `grp:req-decided:${r.id}` } });
    expect(g?.toGroupId).toBeTruthy();
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(before + 1);
  });

  it("đơn của Nhân sự chỉ Quản trị duyệt được", async () => {
    const day = addDays(todayVN(), 10);
    const r = await prisma.leaveRequest.create({
      data: { employeeId: hr.id, type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00"), toTime: vnDateTime(day, "17:00"), reason: "Nhân sự xin nghỉ phép một ngày" },
    });
    const decide = (cookie: string) =>
      decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", cookie, body: { action: "APPROVE" } }), ctx({ id: String(r.id) }));
    expect((await decide(hrCookie)).status).toBe(403);
    expect((await decide(await sessionCookie(managerKD.id))).status).toBe(403);
    expect((await decide(adminCookie)).status).toBe(200);
  });
});
