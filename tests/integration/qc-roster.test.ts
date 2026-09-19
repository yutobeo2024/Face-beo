/**
 * QC đối kháng cho giai đoạn 3 (nhóm cố định/xoay ca, mẫu tuần, đăng ký & khóa ca tuần).
 * Dùng phòng ban + nhân viên riêng (tạo trong beforeAll) và các tuần +5..+8 / -4..-6 để không va chạm file khác.
 * Test đánh dấu [BUG] là lỗi thật — cố ý để fail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { buildPlanner, recordScan, summarizeRange } from "@/lib/attendance-service";
import { absenceCheck, rosterReminder, rosterReport } from "@/lib/jobs";
import { notifyLateIfNeeded } from "@/lib/notify";
import { byCode, ctx, enrollFake, req, sessionCookie } from "./helpers";

import * as rosterRoute from "@/app/api/roster/route";
import * as registerRoute from "@/app/api/roster/register/route";
import * as copyRoute from "@/app/api/roster/copy-week/route";
import * as historyRoute from "@/app/api/roster/history/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as patternsRoute from "@/app/api/work-patterns/route";
import * as patternRoute from "@/app/api/work-patterns/[id]/route";
import * as dashboardRoute from "@/app/api/dashboard/route";

type Emp = { id: number; code: string; departmentId: number; name: string };
const TS = Date.now() % 1_000_000;
let admin: Emp, hr: Emp, rotKho: Emp;
let deptQ: { id: number; name: string }, deptF: { id: number; name: string }, deptN: { id: number; name: string };
let mgrQ: Emp, mgrF: Emp, rot1: Emp, rot2: Emp, fixSat: Emp, fixF: Emp, fixOT: Emp, fixOff: Emp;
let A: string, H: string, MQ: string, MF: string, E1: string;
let hc: { id: number }, sang: { id: number }, satAm: { id: number };
let patHalfSat: { id: number }, patFullSat: { id: number }, patT2T6: { id: number };
let holidayDate: string;
const created: number[] = [];

const M0 = () => startOfWeek(todayVN());
const W = (n: number) => addDays(M0(), 7 * n);
const dayOf = (monday: string, wd: number) => addDays(monday, wd - 1);

const put = (cookie: string, cells: object[], reason?: string) =>
  rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie, body: { cells, reason } }), ctx());
const register = (cookie: string, week: string, departmentIds: number[]) =>
  registerRoute.POST(req("/api/roster/register", { method: "POST", cookie, body: { week, departmentIds } }), ctx());
const copy = (cookie: string, body: object) => copyRoute.POST(req("/api/roster/copy-week", { method: "POST", cookie, body }), ctx());
const cell = (e: Emp, date: string, shiftId: number | null) => ({ employeeId: e.id, date, shiftId, isDayOff: shiftId == null });
const sched = (e: Emp, date: string) => prisma.workSchedule.findUnique({ where: { employeeId_date: { employeeId: e.id, date } } });
const scan = async (e: Emp, date: string, hhmm: string) => {
  const out = await recordScan({ employeeId: e.id, checkTime: vnDateTime(date, hhmm), source: "MANUAL", createdById: admin.id });
  if (out.status !== "CREATED") throw new Error("scan not created");
  return out;
};
const summary = async (e: Emp, date: string) => (await summarizeRange([e.id], date, date)).summaries.get(`${e.id}|${date}`)!;
const patch = (cookie: string, e: Emp, body: object) =>
  employeeRoute.PATCH(req(`/api/employees/${e.id}`, { method: "PATCH", cookie, body }), ctx({ id: String(e.id) }));

async function mkEmp(i: number, name: string, role: string, departmentId: number, scheduleType: "FIXED" | "ROTATING", workPatternId: number | null, defaultShiftId: number): Promise<Emp> {
  const passwordHash = (await prisma.employee.findUniqueOrThrow({ where: { code: "NV001" } })).passwordHash;
  const e = await prisma.employee.create({
    data: {
      code: `QCR${TS}${i}`.slice(0, 20),
      name,
      phone: `08${String(TS).padStart(6, "0")}${String(i).padStart(2, "0")}`,
      passwordHash,
      mustChangePassword: false,
      role,
      departmentId,
      defaultShiftId,
      scheduleType,
      workPatternId,
    },
  });
  created.push(e.id);
  return e;
}

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  rotKho = await byCode("NV010");
  hc = await prisma.shift.findUniqueOrThrow({ where: { name: "Hành chính" } });
  sang = await prisma.shift.findUniqueOrThrow({ where: { name: "Sáng sớm" } });
  satAm = await prisma.shift.findUniqueOrThrow({ where: { name: "Sáng thứ Bảy" } });
  patHalfSat = await prisma.workPattern.findUniqueOrThrow({ where: { name: "HC T2–T6 + T7 sáng" } });
  patFullSat = await prisma.workPattern.findUniqueOrThrow({ where: { name: "HC T2–T7" } });
  patT2T6 = await prisma.workPattern.create({
    data: { name: `QC T2–T6 ${TS}`, monShiftId: hc.id, tueShiftId: hc.id, wedShiftId: hc.id, thuShiftId: hc.id, friShiftId: hc.id, satShiftId: null, sunShiftId: null },
  });
  deptQ = await prisma.department.create({ data: { name: `QC Xoay ca ${TS}` } });
  deptF = await prisma.department.create({ data: { name: `QC Cố định ${TS}` } });
  deptN = await prisma.department.create({ data: { name: `QC Không QL ${TS}` } });
  mgrQ = await mkEmp(1, "QC Quản lý xoay", "MANAGER", deptQ.id, "FIXED", patFullSat.id, hc.id);
  mgrF = await mkEmp(2, "QC Quản lý cố định", "MANAGER", deptF.id, "FIXED", patFullSat.id, hc.id);
  await prisma.department.update({ where: { id: deptQ.id }, data: { managerId: mgrQ.id } });
  await prisma.department.update({ where: { id: deptF.id }, data: { managerId: mgrF.id } });
  rot1 = await mkEmp(3, "QC Xoay Một", "EMPLOYEE", deptQ.id, "ROTATING", null, hc.id);
  rot2 = await mkEmp(4, "QC Xoay Hai", "EMPLOYEE", deptQ.id, "ROTATING", null, hc.id);
  fixSat = await mkEmp(5, "QC Cố định T7 sáng", "EMPLOYEE", deptQ.id, "FIXED", patHalfSat.id, hc.id);
  fixF = await mkEmp(6, "QC Cố định F", "EMPLOYEE", deptF.id, "FIXED", patT2T6.id, hc.id);
  fixOT = await mkEmp(7, "QC Cố định OT", "EMPLOYEE", deptF.id, "FIXED", patHalfSat.id, hc.id);
  fixOff = await mkEmp(8, "QC Cố định nghỉ T7", "EMPLOYEE", deptF.id, "FIXED", patT2T6.id, hc.id);
  await mkEmp(9, "QC Xoay không QL", "EMPLOYEE", deptN.id, "ROTATING", null, hc.id);
  [A, H, MQ, MF, E1] = await Promise.all([admin, hr, mgrQ, mgrF, rot1].map((e) => sessionCookie(e.id)));
  holidayDate = (await prisma.holiday.create({ data: { date: dayOf(W(-6), 3), name: `QC lễ ${TS}` } })).date;
});

afterAll(async () => {
  await prisma.department.updateMany({ where: { id: { in: [deptQ.id, deptF.id, deptN.id] } }, data: { managerId: null } });
  await prisma.employee.updateMany({ where: { id: { in: created } }, data: { active: false } });
  await prisma.holiday.delete({ where: { date: holidayDate } }).catch(() => {});
});

// ---------------------------------------------------------------------------
describe("QC: nhân viên (EMPLOYEE) bị chặn 403 mọi nơi", () => {
  it("roster GET/PUT, register, copy-week, history, mẫu tuần POST/PATCH/DELETE, dashboard", async () => {
    const w = W(5);
    const statuses = [
      (await rosterRoute.GET(req(`/api/roster?week=${w}`, { cookie: E1 }), ctx())).status,
      (await put(E1, [cell(rot1, w, hc.id)])).status,
      (await register(E1, w, [deptQ.id])).status,
      (await copy(E1, { fromWeek: W(5), toWeek: W(6) })).status,
      (await historyRoute.GET(req(`/api/roster/history?week=${w}`, { cookie: E1 }), ctx())).status,
      (await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: E1, body: { name: "x y z", monShiftId: null, tueShiftId: null, wedShiftId: null, thuShiftId: null, friShiftId: null, satShiftId: null, sunShiftId: null } }), ctx())).status,
      (await patternRoute.PATCH(req(`/api/work-patterns/${patT2T6.id}`, { method: "PATCH", cookie: E1, body: { name: "hack" } }), ctx({ id: String(patT2T6.id) }))).status,
      (await patternRoute.DELETE(req(`/api/work-patterns/${patT2T6.id}`, { method: "DELETE", cookie: E1 }), ctx({ id: String(patT2T6.id) }))).status,
      (await dashboardRoute.GET(req("/api/dashboard", { cookie: E1 }), ctx())).status,
    ];
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403]);
    expect(await sched(rot1, w)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("QC: quy tắc sửa/đăng ký của Quản lý", () => {
  it("PUT trộn phòng mình + phòng khác => 403, không ghi ô nào (tất cả hoặc không)", async () => {
    const d = dayOf(W(5), 1);
    expect((await put(MQ, [cell(rot1, d, hc.id)])).status).toBe(200);
    const res = await put(MQ, [cell(rot1, d, sang.id), cell(rotKho, d, sang.id)]);
    expect(res.status).toBe(403);
    expect((await sched(rot1, d))?.shiftId).toBe(hc.id);
    expect(await sched(rotKho, d)).toBeNull();
  });

  it("PUT trộn tuần chưa bắt đầu + tuần đang chạy => 403, không ghi gì", async () => {
    const d = dayOf(W(5), 2);
    const res = await put(MQ, [cell(rot1, d, hc.id), cell(rot1, todayVN(), hc.id)]);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Tuần đã bắt đầu");
    expect(await sched(rot1, d)).toBeNull();
  });

  it("Quản lý phòng khác (không có phòng xoay ca) không đăng ký/sửa được phòng QC; GET scope rỗng", async () => {
    expect((await register(MF, W(5), [deptQ.id])).status).toBe(403);
    expect((await put(MF, [cell(rot1, dayOf(W(5), 3), hc.id)])).status).toBe(403);
    const r = await (await rosterRoute.GET(req(`/api/roster?week=${W(5)}&departmentId=${deptQ.id}`, { cookie: MF }), ctx())).json();
    expect(r.employees).toEqual([]);
  });

  it("đăng ký tuần W+5; đăng ký lại là no-op; phòng không hợp lệ => 400", async () => {
    await put(MQ, [cell(rot2, dayOf(W(5), 1), hc.id)]);
    const r1 = await (await register(MQ, dayOf(W(5), 3), [deptQ.id])).json(); // ngày giữa tuần => chuẩn hóa về thứ Hai
    expect(r1).toEqual({ registered: 1, week: W(5) });
    const r2 = await (await register(MQ, W(5), [deptQ.id])).json();
    expect(r2.registered).toBe(0);
    expect((await register(H, W(5), [deptQ.id, 99_999_999])).status).toBe(400);
    const g = await (await rosterRoute.GET(req(`/api/roster?week=${W(5)}`, { cookie: MQ }), ctx())).json();
    expect(g.departments[String(deptQ.id)]).toMatchObject({ status: "REGISTERED", canEdit: false, canRegister: false });
    const gh = await (await rosterRoute.GET(req(`/api/roster?week=${W(5)}&departmentId=${deptQ.id}`, { cookie: H }), ctx())).json();
    expect(gh.departments[String(deptQ.id)]).toMatchObject({ canEdit: true, needReason: true });
  });

  it("tuần đã đăng ký: Quản lý không sửa/xóa/copy vào; Nhân sự & Quản trị phải có lý do (trim, ≥5, ≤300)", async () => {
    const d = dayOf(W(5), 1);
    expect((await put(MQ, [cell(rot1, d, sang.id)])).status).toBe(403);
    expect((await put(MQ, [{ ...cell(rot1, d, null), clear: true }])).status).toBe(403);
    expect((await put(MQ, [cell(rot1, dayOf(W(7), 2), hc.id)])).status).toBe(200); // nguồn W+7 (nháp) có dữ liệu
    expect((await copy(MQ, { fromWeek: W(7), toWeek: W(5) })).status).toBe(403);
    expect((await put(H, [cell(rot1, d, sang.id)], "   ab   ")).status).toBe(400);
    expect((await put(A, [cell(rot1, d, sang.id)])).status).toBe(400);
    expect((await put(H, [cell(rot1, d, sang.id)], "x".repeat(301))).status).toBe(400);
    expect((await sched(rot1, d))?.shiftId).toBe(hc.id);

    const groups = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    const r = await put(H, [cell(rot1, d, sang.id)], "Đổi ca theo yêu cầu");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ saved: 1, changed: 1 });
    expect(await prisma.auditLog.count({ where: { action: "ROSTER_CHANGE", entityId: `${deptQ.id}|${W(5)}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(groups + 1);
    // ghi lại cùng giá trị: không có thay đổi => không nhật ký / không tin nhóm
    expect(await (await put(H, [cell(rot1, d, sang.id)], "Ghi lại y như cũ")).json()).toEqual({ saved: 1, changed: 0 });
    expect(await prisma.auditLog.count({ where: { action: "ROSTER_CHANGE", entityId: `${deptQ.id}|${W(5)}` } })).toBe(1);
  });

  it("PUT với shiftId không tồn tại phải trả 400 (không phải 500)", async () => {
    const res = await put(H, [cell(rot1, dayOf(W(6), 4), 99_999)]);
    expect(res.status).toBe(400);
  });

  it("PUT nhiều ô, ô sau lỗi (ca không tồn tại) => ô trước KHÔNG được ghi (tất cả hoặc không)", async () => {
    const d = dayOf(W(6), 5);
    const res = await put(H, [cell(rot1, d, hc.id), cell(rot2, d, 99_999)]);
    expect(res.status).toBeLessThan(500);
    expect(await sched(rot1, d)).toBeNull();
  });

  it("PUT nhân viên không tồn tại => lỗi 4xx", async () => {
    const res = await put(H, [{ employeeId: 99_999_999, date: W(6), shiftId: hc.id, isDayOff: false }]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
describe("QC: sao chép tuần (copy-week) theo cùng quy tắc", () => {
  it("Quản lý copy W+5 → W+6 (nháp): chép đúng, W+6 vẫn chưa có hiệu lực", async () => {
    const r = await copy(MQ, { fromWeek: W(5), toWeek: dayOf(W(6), 4) });
    expect(r.status).toBe(200);
    expect((await sched(rot1, dayOf(W(6), 1)))?.shiftId).toBe(sang.id);
    expect((await sched(rot2, dayOf(W(6), 1)))?.shiftId).toBe(hc.id);
    const p = await buildPlanner([rot1.id], dayOf(W(6), 1), dayOf(W(6), 1));
    expect(p.planFor(rot1.id, dayOf(W(6), 1)).unscheduled).toBe(true);
  });

  it("Quản lý copy vào tuần đang chạy => 403; nguồn = đích => 400", async () => {
    expect((await copy(MQ, { fromWeek: W(5), toWeek: M0() })).status).toBe(403);
    expect((await copy(MQ, { fromWeek: W(5), toWeek: dayOf(W(5), 6) })).status).toBe(400);
  });

  it("Quản lý copy với departmentId / employeeIds phòng khác: không đụng tới phòng khác", async () => {
    const r1 = await copy(MQ, { fromWeek: M0(), toWeek: W(7), departmentId: rotKho.departmentId });
    expect(r1.status).toBe(400); // ngoài phạm vi => không có nguồn để chép
    const r2 = await copy(MQ, { fromWeek: M0(), toWeek: W(7), employeeIds: [rotKho.id] });
    expect(r2.status).toBe(400);
    expect(await prisma.workSchedule.count({ where: { employeeId: rotKho.id, date: { gte: W(7), lte: dayOf(W(7), 7) } } })).toBe(0);
  });

  it("Nhân sự copy vào tuần đã đăng ký: thiếu lý do 400; có lý do 200 + nhật ký ROSTER_CHANGE", async () => {
    await put(H, [cell(rot1, dayOf(W(6), 2), null)]); // W+6 nháp: rot1 thứ Ba nghỉ (khác W+5)
    expect((await copy(H, { fromWeek: W(6), toWeek: W(5), departmentId: deptQ.id })).status).toBe(400);
    const before = await prisma.auditLog.count({ where: { action: "ROSTER_CHANGE", entityId: `${deptQ.id}|${W(5)}` } });
    const r = await copy(H, { fromWeek: W(6), toWeek: W(5), departmentId: deptQ.id, reason: "Sao chép lịch tuần sau" });
    expect(r.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "ROSTER_CHANGE", entityId: `${deptQ.id}|${W(5)}` } })).toBe(before + 1);
    expect((await sched(rot1, dayOf(W(5), 2)))?.isDayOff).toBe(true);
  });

  it("copy = thay thế: ô ở tuần đích mà tuần nguồn không có bị xóa", async () => {
    await put(MQ, [cell(rot1, dayOf(W(7), 7), hc.id)]); // ô CN tuần W+7 (nháp)
    await copy(MQ, { fromWeek: W(6), toWeek: W(7) }); // W+6 không có ô CN
    expect(await sched(rot1, dayOf(W(7), 7))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("QC: nháp không ảnh hưởng chấm công", () => {
  it("xoay ca tuần chưa đăng ký: quét => ngoài ca, không trễ, không nhắc trễ, trạng thái NO_SCHEDULE, không báo vắng", async () => {
    const mon = dayOf(W(6), 1); // rot1 có nháp Sáng sớm, W+6 chưa đăng ký
    const out = await scan(rot1, mon, "08:30");
    expect(out.log.shiftId).toBeNull();
    expect(out.log.isLate).toBe(false);
    expect(await notifyLateIfNeeded({ employeeId: rot1.id, log: out.log, plan: out.plan, requests: out.requests })).toBeNull();
    expect((await summary(rot1, mon)).status).toBe("NO_SCHEDULE");

    const tue = dayOf(W(6), 2);
    await enrollFake(rot2.id, 9101);
    await absenceCheck(vnDateTime(tue, "10:30"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `absent:${rot2.id}:${tue}` } })).toBe(0);
  });

  it("đối chứng: tuần đã đăng ký thì xoay ca bị báo vắng", async () => {
    const mon = dayOf(W(5), 1); // rot2 Hành chính, W+5 đã đăng ký
    await absenceCheck(vnDateTime(mon, "10:30"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `absent:${rot2.id}:${mon}` } })).toBe(1);
  });

  it("nháp cho nhân viên CỐ ĐỊNH bị bỏ qua: vẫn theo mẫu tuần", async () => {
    const mon = dayOf(W(7), 1);
    expect((await put(H, [cell(fixSat, mon, null)])).status).toBe(200);
    const p = (await buildPlanner([fixSat.id], mon, mon)).planFor(fixSat.id, mon);
    expect(p.source).toBe("PATTERN");
    expect(p.shift?.id).toBe(hc.id);
  });

  it("đăng ký muộn (Nhân sự) tuần đã qua gán lại log; sửa tuần đã đăng ký tính lại trễ; Quản lý bị chặn", async () => {
    const tue = dayOf(W(-5), 2);
    const a = await scan(rot2, tue, "08:12");
    const b = await scan(rot2, tue, "17:05");
    expect(a.log.shiftId).toBeNull();
    expect((await put(H, [cell(rot2, tue, hc.id)])).status).toBe(200); // nháp, không cần lý do
    expect((await prisma.attendanceLog.findUniqueOrThrow({ where: { id: a.log.id } })).shiftId).toBeNull();
    expect((await register(MQ, W(-5), [deptQ.id])).status).toBe(403);
    expect((await register(H, W(-5), [deptQ.id])).status).toBe(200);
    let la = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: a.log.id } });
    expect(la.shiftId).toBe(hc.id);
    expect(la.isLate).toBe(true);
    expect(la.lateMinutes).toBe(12);
    expect((await prisma.attendanceLog.findUniqueOrThrow({ where: { id: b.log.id } })).type).toBe("OUT");
    expect((await summary(rot2, tue)).status).toBe("LATE");

    // Sửa tuần đã đăng ký (đã qua): tính lại theo ca mới 07:00
    expect((await put(H, [cell(rot2, tue, sang.id)])).status).toBe(400);
    expect((await put(H, [cell(rot2, tue, sang.id)], "Thực tế làm ca sáng sớm")).status).toBe(200);
    la = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: a.log.id } });
    expect(la.shiftId).toBe(sang.id);
    expect(la.lateMinutes).toBe(72);
  });
});

// ---------------------------------------------------------------------------
describe("QC: mẫu tuần CRUD", () => {
  it("chỉ org.manage: HR/Quản lý 403; trùng tên / ca không tồn tại 400; xóa mẫu đang dùng 400", async () => {
    const body = { name: `QC mẫu ${TS}`, monShiftId: hc.id, tueShiftId: hc.id, wedShiftId: hc.id, thuShiftId: hc.id, friShiftId: hc.id, satShiftId: null, sunShiftId: null };
    expect((await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: MQ, body }), ctx())).status).toBe(403);
    const created = await patternsRoute.POST(req("/api/work-patterns", { method: "POST", cookie: A, body }), ctx());
    expect(created.status).toBe(201);
    const pid = (await created.json()).pattern.id as number;
    const p = (b: object, cookie = A) => patternRoute.PATCH(req(`/api/work-patterns/${pid}`, { method: "PATCH", cookie, body: b }), ctx({ id: String(pid) }));
    expect((await p({ satShiftId: satAm.id }, H)).status).toBe(403);
    expect((await p({ name: "HC T2–T7" })).status).toBe(400);
    expect((await p({ monShiftId: 99_999 })).status).toBe(400);
    expect((await p({ satShiftId: satAm.id })).status).toBe(200);
    expect((await patternRoute.DELETE(req(`/api/work-patterns/${patT2T6.id}`, { method: "DELETE", cookie: A }), ctx({ id: String(patT2T6.id) }))).status).toBe(400);
    expect((await patternRoute.DELETE(req(`/api/work-patterns/${pid}`, { method: "DELETE", cookie: H }), ctx({ id: String(pid) }))).status).toBe(403);
    expect((await patternRoute.DELETE(req(`/api/work-patterns/${pid}`, { method: "DELETE", cookie: A }), ctx({ id: String(pid) }))).status).toBe(200);
  });

  it("sửa mẫu tuần chỉ có hiệu lực từ hôm nay: ngày đã qua giữ nguyên (không hồi tố thành VẮNG)", async () => {
    // fixOff dùng mẫu QC T2–T6 (T7 nghỉ). Thứ Bảy tuần -4: có quét 08:00 & 12:00 => ngoài ca.
    const pat = await prisma.workPattern.create({ data: { name: `QC T2–T6 riêng ${TS}`, monShiftId: hc.id, tueShiftId: hc.id, wedShiftId: hc.id, thuShiftId: hc.id, friShiftId: hc.id, satShiftId: null, sunShiftId: null } });
    await prisma.employee.update({ where: { id: fixOff.id }, data: { workPatternId: pat.id } });
    const sat = dayOf(W(-4), 6);
    const a = await scan(fixOff, sat, "08:00");
    await scan(fixOff, sat, "12:00");
    expect(a.log.shiftId).toBeNull();
    const res = await patternRoute.PATCH(req(`/api/work-patterns/${pat.id}`, { method: "PATCH", cookie: A, body: { satShiftId: satAm.id } }), ctx({ id: String(pat.id) }));
    expect(res.status).toBe(200);
    const s = await summary(fixOff, sat);
    // Thứ Bảy đã qua vẫn theo mẫu cũ (nghỉ) => làm ngoài ca, không vắng; log không bị đổi.
    expect(s.status).not.toBe("ABSENT");
    expect((await prisma.attendanceLog.findUniqueOrThrow({ where: { id: a.log.id } })).shiftId).toBeNull();
    // Từ hôm nay: thứ Bảy theo mẫu mới.
    let nextSat = todayVN();
    while (weekday(nextSat) !== 6) nextSat = addDays(nextSat, 1);
    expect((await buildPlanner([fixOff.id], nextSat, nextSat)).planFor(fixOff.id, nextSat).shift?.id).toBe(satAm.id);
  });
});

// ---------------------------------------------------------------------------
describe("QC: PATCH nhân viên — loại lịch / mẫu tuần / phòng ban", () => {
  it("FIXED → ROTATING xóa mẫu tuần; ROTATING + workPatternId bị bỏ qua; mẫu không tồn tại 400 và không đổi gì", async () => {
    expect((await patch(H, fixF, { scheduleType: "ROTATING" })).status).toBe(200);
    let e = await prisma.employee.findUniqueOrThrow({ where: { id: fixF.id } });
    expect(e).toMatchObject({ scheduleType: "ROTATING", workPatternId: null });
    expect((await patch(H, fixF, { workPatternId: patHalfSat.id })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: fixF.id } })).workPatternId).toBeNull();
    expect((await patch(H, fixF, { scheduleType: "FIXED", workPatternId: 99_999 })).status).toBe(400);
    e = await prisma.employee.findUniqueOrThrow({ where: { id: fixF.id } });
    expect(e.scheduleType).toBe("ROTATING");
    expect((await patch(H, fixF, { scheduleType: "FIXED", workPatternId: patT2T6.id })).status).toBe(200);
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: fixF.id } })).toMatchObject({ scheduleType: "FIXED", workPatternId: patT2T6.id });
    expect((await patch(MQ, fixF, { scheduleType: "ROTATING" })).status).toBe(403);
  });

  it("đổi FIXED → ROTATING chỉ áp dụng từ hôm nay: ngày đã qua giữ ca cũ, bảng công và log nhất quán", async () => {
    const mon = dayOf(W(-6), 1);
    const a = await scan(fixF, mon, "07:58");
    await scan(fixF, mon, "17:02");
    expect(a.log.shiftId).toBe(hc.id);
    expect((await patch(H, fixF, { scheduleType: "ROTATING" })).status).toBe(200);
    const log = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: a.log.id } });
    const s = await summary(fixF, mon);
    await patch(H, fixF, { scheduleType: "FIXED", workPatternId: patT2T6.id });
    expect(s.status).toBe("ON_TIME");
    expect(log.shiftId).toBe(hc.id);
  });

  it("chuyển nhân viên xoay ca sang phòng đã đăng ký: lịch NHÁP tương lai của phòng cũ bị hủy, không tự có hiệu lực", async () => {
    const d = dayOf(W(8), 1);
    expect((await put(MQ, [cell(rot1, d, sang.id)])).status).toBe(200); // nháp ở phòng QC (W+8 chưa đăng ký)
    expect((await register(MF, W(8), [deptF.id])).status).toBe(200); // phòng F chỉ có nhân viên cố định
    expect((await patch(H, rot1, { departmentId: deptF.id })).status).toBe(200);
    const p = (await buildPlanner([rot1.id], d, d)).planFor(rot1.id, d);
    await patch(H, rot1, { departmentId: deptQ.id });
    expect(p.shift?.id).not.toBe(sang.id);
    expect(await sched(rot1, d)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("QC: làm thêm ngày nghỉ / ngày lễ", () => {
  const ot = async (e: Emp, date: string, from: string, to: string, status = "APPROVED") =>
    prisma.leaveRequest.create({ data: { employeeId: e.id, type: "TANG_CA_OT", fromTime: vnDateTime(date, from), toTime: vnDateTime(date, to), reason: "Tăng ca ngày nghỉ QC", status } });

  it("Chủ nhật: không đơn => OT 0; có đơn duyệt => OT = giao có mặt & đơn", async () => {
    const sun1 = dayOf(W(-4), 7);
    await scan(fixOT, sun1, "08:00");
    await scan(fixOT, sun1, "12:00");
    let s = await summary(fixOT, sun1);
    expect(s.status).toBe("OUT_OF_SHIFT");
    expect(s.otMinutes).toBe(0);

    const sun2 = dayOf(W(-5), 7);
    await scan(fixOT, sun2, "08:00");
    await scan(fixOT, sun2, "12:00");
    const r = await ot(fixOT, sun2, "07:00", "11:00");
    s = await summary(fixOT, sun2);
    expect(s.otMinutes).toBe(180);
    expect(s.relatedRequestIds).toContain(r.id);
  });

  it("ngày nghỉ theo mẫu (T7 của mẫu T2–T6): đơn PENDING => 0, APPROVED => có OT", async () => {
    const sat = dayOf(W(-6), 6);
    await scan(fixF, sat, "09:00");
    await scan(fixF, sat, "11:00");
    const r = await ot(fixF, sat, "09:00", "11:00", "PENDING");
    expect((await summary(fixF, sat)).otMinutes).toBe(0);
    await prisma.leaveRequest.update({ where: { id: r.id }, data: { status: "APPROVED" } });
    expect((await summary(fixF, sat)).otMinutes).toBe(120);
  });

  it("ngày lễ: có mặt + đơn duyệt => OT, holidayWork", async () => {
    const hol = dayOf(W(-6), 3);
    await scan(fixOT, hol, "08:00");
    await scan(fixOT, hol, "17:00");
    let s = await summary(fixOT, hol);
    expect(s.holidayWork).toBe(true);
    expect(s.otMinutes).toBe(0);
    await ot(fixOT, hol, "08:00", "17:00");
    s = await summary(fixOT, hol);
    expect(s.otMinutes).toBe(540);
  });

  it("(hành vi) xoay ca tuần chưa đăng ký + đơn OT duyệt => NO_SCHEDULE, OT 0", async () => {
    const sun = dayOf(W(-4), 7);
    await scan(rot1, sun, "08:00");
    await scan(rot1, sun, "12:00");
    await ot(rot1, sun, "08:00", "12:00");
    const s = await summary(rot1, sun);
    expect(s.status).toBe("NO_SCHEDULE");
    expect(s.otMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("QC: mẫu 'HC T2–T6 + T7 sáng' — thứ Bảy 08:00–12:00", () => {
  it("vào 08:12 / ra 11:40 => trễ 12, về sớm 20 (so với 08–12, không phải 08–17)", async () => {
    const sat = dayOf(W(-6), 6);
    await scan(fixSat, sat, "08:12");
    await scan(fixSat, sat, "11:40");
    const s = await summary(fixSat, sat);
    expect(s.shift?.id).toBe(satAm.id);
    expect(s).toMatchObject({ isLate: true, lateMinutes: 12, isEarly: true, earlyMinutes: 20 });
  });

  it("vào 07:58 / ra 12:03 => đúng giờ, không về sớm", async () => {
    const sat = dayOf(W(-5), 6);
    await scan(fixSat, sat, "07:58");
    await scan(fixSat, sat, "12:03");
    const s = await summary(fixSat, sat);
    expect(s).toMatchObject({ status: "ON_TIME", isLate: false, isEarly: false });
  });
});

// ---------------------------------------------------------------------------
describe("QC: job nhắc đăng ký ca", () => {
  it("rosterReminder chỉ nhắc phòng có xoay ca; phòng chỉ cố định không nhắc; không quản lý => Quản trị; chống trùng", async () => {
    let fri = W(7);
    while (weekday(fri) !== 5) fri = addDays(fri, 1);
    const target = W(8);
    const r1 = await rosterReminder(vnDateTime(fri, "15:00"));
    expect(r1.week).toBe(target);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${deptQ.id}:${target}:${mgrQ.id}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `roster-remind:${deptF.id}:` } } })).toBe(0);
    const mgrHC = await byCode("NV002");
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${mgrHC.departmentId}:${target}:${mgrHC.id}` } })).toBe(0);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${deptN.id}:${target}:${admin.id}` } })).toBe(1);
    const r2 = await rosterReminder(vnDateTime(fri, "15:30"));
    expect(r2.sent).toBe(0);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-remind:${deptQ.id}:${target}:${mgrQ.id}` } })).toBe(1);
  });

  it("rosterReport chống trùng và không liệt kê phòng chỉ cố định", async () => {
    const target = W(8);
    await rosterReport(vnDateTime(target, "07:00"));
    await rosterReport(vnDateTime(target, "07:10"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `roster-unreg:${target}:${hr.id}` } })).toBe(1);
    const g = await prisma.notificationLog.findMany({ where: { dedupeKey: `grp:roster-unreg:${target}` } });
    expect(g.length).toBe(1);
    expect(g[0].payload).toContain(deptQ.name);
    expect(g[0].payload).not.toContain(deptF.name);
  });
});

// ---------------------------------------------------------------------------
describe("QC: dashboard — cảnh báo đăng ký ca & danh sách chưa có lịch", () => {
  it("Quản trị thấy phòng QC chưa đăng ký tuần này/tuần sau và nhân viên xoay ca chưa có lịch; phòng chỉ cố định không bị cảnh báo", async () => {
    const d = await (await dashboardRoute.GET(req("/api/dashboard", { cookie: A }), ctx())).json();
    const thisW = d.rosterWarnings.find((x: { week: string }) => x.week === M0());
    expect(thisW?.departments).toContain(deptQ.name);
    expect(thisW?.departments).not.toContain(deptF.name);
    const codes = d.unscheduled.map((x: { code: string }) => x.code);
    expect(codes).toEqual(expect.arrayContaining([rot1.code, rot2.code]));
    expect(codes).not.toContain(fixSat.code);
  });

  it("Quản lý chỉ thấy phòng mình; phòng chỉ cố định => không cảnh báo", async () => {
    const q = await (await dashboardRoute.GET(req("/api/dashboard", { cookie: MQ }), ctx())).json();
    for (const w of q.rosterWarnings) expect(w.departments).toEqual([deptQ.name]);
    expect(q.unscheduled.every((x: { department: string }) => x.department === deptQ.name)).toBe(true);
    const f = await (await dashboardRoute.GET(req("/api/dashboard", { cookie: MF }), ctx())).json();
    expect(f.rosterWarnings).toEqual([]);
    expect(f.unscheduled).toEqual([]);
  });
});
