// v1.12.0: "Không chấm công" (Ban Giám đốc / Quản trị) — theo phòng + từng người: không cảnh báo, không Zalo, ẩn khỏi chấm công / báo cáo / xếp ca.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { absenceCheck, missingCheckout } from "@/lib/jobs";
import { buildAttendanceReport } from "@/lib/reports";
import { createEmployee } from "@/lib/employees";
import { byCode, ctx, enrollFake, req, sessionCookie } from "./helpers";

import * as deptRoute from "@/app/api/departments/[id]/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as attendanceRoute from "@/app/api/attendance/route";
import * as rosterRoute from "@/app/api/roster/route";

const tag = `X${Date.now().toString().slice(-5)}`;
let deptId = 0;
let boss = 0, exception = 0, staff = 0, personal = 0; // boss: theo phòng (miễn) · exception: "vẫn chấm" trong phòng miễn · staff: phòng thường · personal: miễn riêng
let A: string, H: string;
const monday = addDays(startOfWeek(todayVN()), 7); // thứ Hai tuần sau: ai cũng có ca Hành chính
const ids = () => [boss, exception, staff, personal];
const sent = (key: string) => prisma.notificationLog.count({ where: { dedupeKey: key } });

beforeAll(async () => {
  const [admin, hr] = await Promise.all(["NV001", "NV016"].map(byCode));
  [A, H] = await Promise.all([admin.id, hr.id].map(sessionCookie));
  const hc = await prisma.shift.findFirstOrThrow({ where: { name: "Hành chính" } });
  const pattern = await prisma.workPattern.findFirstOrThrow({ where: { monShiftId: hc.id } });
  const bgd = await prisma.department.create({ data: { name: `Ban Giám đốc ${tag}` } });
  const normal = await prisma.department.create({ data: { name: `Phòng thường ${tag}` } });
  deptId = bgd.id;
  const mk = async (code: string, departmentId: number) =>
    (await createEmployee({ code: `${tag}${code}`, name: `NV ${code}`, role: "EMPLOYEE", departmentId, defaultShiftId: hc.id, scheduleType: "FIXED", workPatternId: pattern.id } as never, null)).employee.id;
  [boss, exception, staff, personal] = [await mk("A", bgd.id), await mk("B", bgd.id), await mk("C", normal.id), await mk("D", normal.id)];
  for (const [i, id] of ids().entries()) await enrollFake(id, 900 + i);
  // Quản trị bật "Không chấm công" cho phòng; đặt riêng từng người.
  expect((await deptRoute.PATCH(req(`/api/departments/${bgd.id}`, { method: "PATCH", cookie: A, body: { attendanceExempt: true } }), ctx({ id: String(bgd.id) }))).status).toBe(200);
  expect((await employeeRoute.PATCH(req(`/api/employees/${exception}`, { method: "PATCH", cookie: A, body: { attendanceExempt: false } }), ctx({ id: String(exception) }))).status).toBe(200);
  expect((await employeeRoute.PATCH(req(`/api/employees/${personal}`, { method: "PATCH", cookie: A, body: { attendanceExempt: true } }), ctx({ id: String(personal) }))).status).toBe(200);
});

afterAll(async () => {
  const depts = (await prisma.employee.findMany({ where: { id: { in: ids() } }, select: { departmentId: true } })).map((e) => e.departmentId);
  await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids() } } });
  await prisma.faceTemplate.deleteMany({ where: { employeeId: { in: ids() } } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids() } } });
  await prisma.notificationLog.deleteMany({ where: { toEmployeeId: { in: ids() } } });
  await prisma.auditLog.deleteMany({ where: { entity: "AttendanceDay", entityId: { startsWith: `${boss}|` } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids() } } });
  await prisma.department.deleteMany({ where: { id: { in: [...new Set(depts)] } } });
});

describe("chặn cảnh báo & Zalo", () => {
  it("chưa chấm giờ vào: người được chấm công nhận nhắc; người không chấm công (theo phòng / riêng) thì không", async () => {
    await absenceCheck(vnDateTime(monday, "10:00"));
    expect(await sent(`absent:${staff}:${monday}`)).toBeGreaterThan(0);
    expect(await sent(`absent:${exception}:${monday}`)).toBeGreaterThan(0); // "vẫn chấm công" dù phòng miễn
    expect(await sent(`absent:${boss}:${monday}`)).toBe(0);
    expect(await sent(`absent:${personal}:${monday}`)).toBe(0);
  });

  it("quên chấm giờ ra: người không chấm công lỡ quét vào thì không bị nhắc", async () => {
    for (const id of ids()) await recordScan({ employeeId: id, checkTime: vnDateTime(monday, "07:58"), source: "KIOSK" });
    await missingCheckout(vnDateTime(monday, "23:00"));
    expect(await sent(`missing-out:${staff}|${monday}`)).toBeGreaterThan(0);
    expect(await sent(`missing-out:${boss}|${monday}`)).toBe(0);
    expect(await sent(`missing-out:${personal}|${monday}`)).toBe(0);
    expect(await prisma.attendanceLog.count({ where: { employeeId: boss, workDate: monday } })).toBe(1); // log vẫn được ghi
  });
});

describe("ẩn khỏi màn hình / báo cáo", () => {
  it("Tổng quan, Chấm công, Báo cáo, Xếp ca chỉ còn người được chấm công", async () => {
    const both = (await prisma.employee.findMany({ where: { id: { in: ids() } }, select: { departmentId: true } })).map((e) => e.departmentId);
    for (const d of new Set(both)) {
      const dash = await (await dashboardRoute.GET(req(`/api/dashboard?departmentId=${d}`, { cookie: A }), ctx())).json();
      const inDash = [...dash.late, ...dash.absent, ...dash.manual, ...dash.unscheduled].map((p: { id: number }) => p.id);
      expect(inDash).not.toContain(boss);
      expect(inDash).not.toContain(personal);
    }
    const dashBgd = await (await dashboardRoute.GET(req(`/api/dashboard?departmentId=${deptId}`, { cookie: A }), ctx())).json();
    expect(dashBgd.totalEmployees).toBe(1); // chỉ người "vẫn chấm công"

    const att = await (await attendanceRoute.GET(req(`/api/attendance?from=${monday}&to=${monday}`, { cookie: A }), ctx())).json();
    const attIds = JSON.stringify(att);
    expect(attIds).not.toContain(`${tag}A`);
    expect(attIds).toContain(`${tag}C`);

    const rep = await buildAttendanceReport({}, monday, monday);
    const repIds = rep.summary.map((r: { employeeId?: number; id?: number }) => r.employeeId ?? r.id);
    expect(repIds).toContain(staff);
    expect(repIds).toContain(exception);
    expect(repIds).not.toContain(boss);
    expect(repIds).not.toContain(personal);

    const roster = JSON.stringify(await (await rosterRoute.GET(req(`/api/roster?week=${monday}&group=all`, { cookie: A }), ctx())).json());
    expect(roster).not.toContain(`${tag}A`);
    expect(roster).toContain(`${tag}C`);
  });

  it("danh sách nhân viên trả chế độ chấm công hiệu lực + nguồn", async () => {
    const list = (await (await employeesRoute.GET(req("/api/employees", { cookie: A }), ctx())).json()).employees as { id: number; attendance: { exempt: boolean; source: string | null } }[];
    const by = (id: number) => list.find((e) => e.id === id)!.attendance;
    expect(by(boss)).toEqual({ exempt: true, source: "DEPARTMENT" });
    expect(by(personal)).toEqual({ exempt: true, source: "EMPLOYEE" });
    expect(by(exception)).toEqual({ exempt: false, source: null });
    expect(by(staff)).toEqual({ exempt: false, source: null });
  });
});

describe("quyền", () => {
  it("chỉ Quản trị đổi được chế độ chấm công (phòng / người); đổi được báo nhóm minh bạch", async () => {
    expect((await deptRoute.PATCH(req(`/api/departments/${deptId}`, { method: "PATCH", cookie: H, body: { attendanceExempt: false } }), ctx({ id: String(deptId) }))).status).toBe(403);
    expect((await employeeRoute.PATCH(req(`/api/employees/${staff}`, { method: "PATCH", cookie: H, body: { attendanceExempt: true } }), ctx({ id: String(staff) }))).status).toBe(403);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: staff } })).attendanceExempt).toBeNull();
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `grp:dept-exempt:${deptId}:` } } })).toBeGreaterThan(0);
  });
});
