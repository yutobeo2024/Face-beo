import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { buildPlanner, recordScan } from "@/lib/attendance-service";
import { absenceCheck, rosterReminder, rosterReport } from "@/lib/jobs";
import { byCode, ctx, enrollFake, req, sessionCookie } from "./helpers";

import * as rosterRoute from "@/app/api/roster/route";
import * as registerRoute from "@/app/api/roster/register/route";
import * as historyRoute from "@/app/api/roster/history/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as patternsRoute from "@/app/api/work-patterns/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgrKho: E, mgrKD: E, rotKho: E, rotKT: E, fixedHC: E;
let A: string, H: string, MKHO: string, MKD: string;
let hc: { id: number };

const thisMonday = () => startOfWeek(todayVN());
const put = (cookie: string, cells: object[], reason?: string) => rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie, body: { cells, reason } }), ctx());
const register = (cookie: string, week: string, departmentIds: number[]) =>
  registerRoute.POST(req("/api/roster/register", { method: "POST", cookie, body: { week, departmentIds } }), ctx());
const cell = (e: E, date: string, shiftId: number | null) => ({ employeeId: e.id, date, shiftId, isDayOff: shiftId == null });

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  mgrKho = await byCode("NV005"); // Kho vận
  mgrKD = await byCode("NV003"); // Kinh doanh
  rotKho = await byCode("NV010"); // xoay ca, Kho vận
  rotKT = await byCode("NV012"); // xoay ca, Kỹ thuật
  fixedHC = await byCode("NV007"); // cố định, mẫu "HC T2–T6 + T7 sáng"
  [A, H, MKHO, MKD] = await Promise.all([admin, hr, mgrKho, mgrKD].map((e) => sessionCookie(e.id)));
  hc = await prisma.shift.findUniqueOrThrow({ where: { name: "Hành chính" } });
});

describe("đăng ký & khóa ca tuần", () => {
  it("quản lý xếp nháp tuần chưa bắt đầu, đăng ký; sau đó bị khóa, chỉ Nhân sự sửa được (kèm lý do)", async () => {
    const week = addDays(thisMonday(), 14);
    // Quản lý phòng khác không xếp được
    expect((await put(MKD, [cell(rotKho, week, hc.id)])).status).toBe(403);
    // Quản lý phòng mình: nháp OK, chưa có hiệu lực tính công
    expect((await put(MKHO, [cell(rotKho, week, hc.id)])).status).toBe(200);
    let planner = await buildPlanner([rotKho.id], week, week);
    expect(planner.planFor(rotKho.id, week).unscheduled).toBe(true);

    expect((await register(MKHO, week, [rotKho.departmentId])).status).toBe(200);
    planner = await buildPlanner([rotKho.id], week, week);
    expect(planner.planFor(rotKho.id, week).shift?.id).toBe(hc.id);

    // Đã đăng ký: quản lý hết quyền sửa
    expect((await put(MKHO, [cell(rotKho, week, null)])).status).toBe(403);
    // Nhân sự: phải có lý do
    expect((await put(H, [cell(rotKho, week, null)])).status).toBe(400);
    const groups = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    expect((await put(H, [cell(rotKho, week, null)], "Nhân viên xin đổi ngày nghỉ")).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "ROSTER_CHANGE", entityId: `${rotKho.departmentId}|${week}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(groups + 1);
    planner = await buildPlanner([rotKho.id], week, week);
    expect(planner.planFor(rotKho.id, week).isDayOff).toBe(true);

    const hist = await (await historyRoute.GET(req(`/api/roster/history?week=${week}`, { cookie: MKHO }), ctx())).json();
    expect(hist.items.map((x: { action: string }) => x.action).sort()).toEqual(["ROSTER_CHANGE", "ROSTER_REGISTER"]);
  });

  it("gian lận 'đổi ca hôm nay để né trễ': quản lý không sửa được tuần đang chạy", async () => {
    const today = todayVN();
    // Hành chính: toàn nhân viên cố định, tuần này chưa đăng ký => vẫn bị chặn vì tuần đã bắt đầu
    const mgrHC = await byCode("NV002");
    const res = await put(await sessionCookie(mgrHC.id), [cell(fixedHC, today, hc.id)]);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Tuần đã bắt đầu");
    // Đăng ký muộn cũng bị chặn với quản lý
    expect((await register(await sessionCookie(mgrHC.id), today, [mgrHC.departmentId])).status).toBe(403);
  });

  it("GET roster trả trạng thái tuần + quyền theo phòng; mặc định chỉ nhóm xoay ca", async () => {
    const r = await (await rosterRoute.GET(req(`/api/roster?week=${thisMonday()}`, { cookie: MKHO }), ctx())).json();
    expect(r.employees.every((e: { scheduleType: string }) => e.scheduleType === "ROTATING")).toBe(true);
    const d = r.departments[String(mgrKho.departmentId)];
    expect(d.status).toBe("REGISTERED");
    expect(d.canEdit).toBe(false);
    const all = await (await rosterRoute.GET(req(`/api/roster?week=${thisMonday()}&group=all`, { cookie: H }), ctx())).json();
    expect(all.employees.some((e: { scheduleType: string }) => e.scheduleType === "FIXED")).toBe(true);
    expect(all.canEditRegistered).toBe(true);
  });
});

describe("nhóm xoay ca chưa có lịch & đăng ký muộn", () => {
  it("tuần chưa đăng ký: không báo vắng nhân viên xoay ca", async () => {
    const monday = addDays(thisMonday(), 21);
    await enrollFake(rotKho.id, 110);
    await absenceCheck(vnDateTime(monday, "09:30"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `absent:${rotKho.id}:${monday}` } })).toBe(0);
  });

  it("Nhân sự đăng ký muộn tuần đã qua => log cũ được gán lại vào ca", async () => {
    const lastMonday = addDays(thisMonday(), -7);
    const out = await recordScan({ employeeId: rotKT.id, checkTime: vnDateTime(lastMonday, "08:03"), source: "MANUAL", createdById: admin.id });
    if (out.status !== "CREATED") throw new Error("scan");
    expect(out.log.shiftId).toBeNull();
    expect((await put(H, [cell(rotKT, lastMonday, hc.id)])).status).toBe(200); // nháp, không cần lý do
    expect((await prisma.attendanceLog.findUniqueOrThrow({ where: { id: out.log.id } })).shiftId).toBeNull();
    expect((await register(H, lastMonday, [rotKT.departmentId])).status).toBe(200);
    const log = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: out.log.id } });
    expect(log.shiftId).toBe(hc.id);
    expect(log.type).toBe("IN");
  });
});

describe("mẫu tuần làm việc", () => {
  it("nhân viên cố định mẫu 'T2–T6 + T7 sáng': thứ Bảy là ca sáng 08:00–12:00", async () => {
    let sat = thisMonday();
    while (weekday(sat) !== 6) sat = addDays(sat, 1);
    const planner = await buildPlanner([fixedHC.id], sat, sat);
    const p = planner.planFor(fixedHC.id, sat);
    expect(p.shift?.name).toBe("Sáng thứ Bảy");
    expect(p.source).toBe("PATTERN");
  });

  it("chỉ Quản trị (org.manage) tạo được mẫu tuần", async () => {
    const body = { name: `Thử ${Date.now()}`, monShiftId: hc.id, tueShiftId: hc.id, wedShiftId: hc.id, thuShiftId: hc.id, friShiftId: hc.id, satShiftId: null, sunShiftId: null };
    expect((await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: H, body }), ctx())).status).toBe(403);
    expect((await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: A, body }), ctx())).status).toBe(201);
    expect((await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: A, body: { ...body, name: `${body.name}b`, monShiftId: 99999 } }), ctx())).status).toBe(400);
  });

  it("sửa hồ sơ nhân viên không làm đổi loại lịch (hồi quy lỗi giá trị mặc định của zod)", async () => {
    const res = await employeeRoute.PATCH(req(`/api/employees/${rotKho.id}`, { method: "PATCH", cookie: H, body: { name: rotKho.name } }), ctx({ id: String(rotKho.id) }));
    expect(res.status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: rotKho.id } })).scheduleType).toBe("ROTATING");
  });
});

describe("job nhắc đăng ký ca", () => {
  it("thứ Sáu nhắc quản lý phòng chưa đăng ký tuần sau; thứ Hai báo Nhân sự + nhóm Zalo", async () => {
    // Thứ Sáu của tuần +3 => "tuần sau" là tuần +4 (chưa phòng nào đăng ký).
    let fri = addDays(thisMonday(), 21);
    while (weekday(fri) !== 5) fri = addDays(fri, 1);
    const target = addDays(startOfWeek(fri), 7);
    const r1 = await rosterReminder(vnDateTime(fri, "15:00"));
    expect(r1.week).toBe(target);
    expect(r1.pending).toBeGreaterThan(0);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${mgrKho.departmentId}:${target}:${mgrKho.id}` } })).toBe(1);
    await rosterReminder(vnDateTime(fri, "15:05"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${mgrKho.departmentId}:${target}:${mgrKho.id}` } })).toBe(1);

    const r2 = await rosterReport(vnDateTime(target, "07:00"));
    expect(r2.pending).toBeGreaterThan(0);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-unreg:${target}:${hr.id}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `grp:roster-unreg:${target}` } })).toBe(1);
  });
});
