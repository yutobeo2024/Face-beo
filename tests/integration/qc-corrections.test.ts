import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, decideAbsence, shouldSendLateReminder, summarizeDay, todayVN, vnDate, vnDateTime, weekday, type DayPlan, type ShiftDef } from "@/lib/attendance";
import { recordScan, summarizeRange } from "@/lib/attendance-service";
import { absenceCheck } from "@/lib/jobs";
import { buildAttendanceReport } from "@/lib/reports";
import { byCode, ctx, enrollFake, req, sessionCookie } from "./helpers";

import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as executeRoute from "@/app/api/requests/[id]/execute/route";
import * as cancelRoute from "@/app/api/requests/[id]/cancel/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgrHC: E, mgrKD: E, mgrKT: E, e7: E, e9: E, e15: E, e13: E;
let A: string, H: string, MHC: string, MKD: string, MKT: string, E7: string, E9: string, E15: string, E13: string;

const REASON = "Quên chấm công vì máy kiosk đông người";
const createRaw = (cookie: string, body: object) => requestsRoute.POST(req("/api/requests", { method: "POST", cookie, body }), ctx());
const create = (cookie: string, at: Date, kind: "IN" | "OUT" = "OUT") =>
  createRaw(cookie, { type: "BO_SUNG_CONG", correctionAt: at.toISOString(), correctionKind: kind, reason: REASON });
const createOk = async (cookie: string, at: Date, kind: "IN" | "OUT" = "OUT") => {
  const res = await create(cookie, at, kind);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()).request as { id: number };
};
const decide = (cookie: string, id: number, action = "APPROVE") =>
  decideRoute.POST(req(`/api/requests/${id}/decide`, { method: "POST", cookie, body: { action, note: action === "REJECT" ? "Không hợp lệ" : undefined } }), ctx({ id: String(id) }));
const execute = (cookie: string, id: number, body: object = {}) =>
  executeRoute.POST(req(`/api/requests/${id}/execute`, { method: "POST", cookie, body }), ctx({ id: String(id) }));
const cancel = (cookie: string, id: number) => cancelRoute.POST(req(`/api/requests/${id}/cancel`, { method: "POST", cookie }), ctx({ id: String(id) }));
const list = async (cookie: string, qs: string) => (await (await requestsRoute.GET(req(`/api/requests?${qs}`, { cookie }), ctx())).json()).requests as Array<Record<string, unknown>>;
const logsOf = (id: number) => prisma.attendanceLog.count({ where: { sourceRequestId: id } });

function pastWorkday(back: number) {
  let d = addDays(todayVN(), -back);
  while (weekday(d) === 7) d = addDays(d, -1);
  return d;
}
async function wipeDay(employeeId: number, d: string) {
  await prisma.attendanceLog.deleteMany({ where: { employeeId, workDate: d } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId, fromTime: { gte: vnDateTime(addDays(d, -1), "00:00"), lt: vnDateTime(addDays(d, 1), "12:00") } } });
}

beforeAll(async () => {
  // Cô lập với file test khác dùng chung DB: xóa đơn bổ sung công + log sinh ra từ đơn.
  await prisma.attendanceLog.deleteMany({ where: { sourceRequestId: { not: null } } });
  await prisma.leaveRequest.deleteMany({ where: { type: "BO_SUNG_CONG" } });
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  mgrHC = await byCode("NV002");
  mgrKD = await byCode("NV003");
  mgrKT = await byCode("NV004");
  e7 = await byCode("NV007"); // Hành chính (QL NV002), ca HC 08-17
  e9 = await byCode("NV009"); // Kỹ thuật (QL NV004)
  e15 = await byCode("NV015"); // Kinh doanh (QL NV003)
  e13 = await byCode("NV013"); // CSKH (QL NV006)
  [A, H, MHC, MKD, MKT, E7, E9, E15, E13] = await Promise.all([admin, hr, mgrHC, mgrKD, mgrKT, e7, e9, e15, e13].map((e) => sessionCookie(e.id)));
});

describe("QC-C1 tạo đơn — dữ liệu xấu", () => {
  it("tương lai / quá 3 ngày / biên 3 ngày", async () => {
    expect((await create(E13, new Date(Date.now() + 10 * 60_000))).status).toBe(400);
    expect((await create(E13, vnDateTime(addDays(todayVN(), -4), "23:59"))).status).toBe(400);
    expect((await create(E13, vnDateTime(addDays(todayVN(), -3), "00:05"), "IN")).status).toBe(201);
  });
  it("kind sai / thiếu trường / ngày sai định dạng", async () => {
    const at = vnDateTime(pastWorkday(1), "09:00").toISOString();
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", correctionAt: at, correctionKind: "INOUT", reason: REASON })).status).toBe(400);
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", correctionAt: at, reason: REASON })).status).toBe(400);
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", correctionKind: "IN", reason: REASON })).status).toBe(400);
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", correctionAt: at, correctionKind: "IN" })).status).toBe(400);
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", correctionAt: "hôm qua", correctionKind: "IN", reason: REASON })).status).toBe(400);
    expect((await createRaw(E13, { type: "BO_SUNG_CONG", fromTime: at, toTime: at, reason: REASON })).status).toBe(400);
  });
  it("trộn trường đơn nghỉ và đơn bổ sung công", async () => {
    const d = pastWorkday(1);
    // NGHI_PHEP mang correctionAt: phải bỏ qua correction*
    const r1 = await createRaw(E13, { type: "NGHI_PHEP", fromTime: vnDateTime(d, "13:00").toISOString(), toTime: vnDateTime(d, "14:00").toISOString(), correctionAt: vnDateTime(d, "13:30").toISOString(), correctionKind: "IN", reason: REASON });
    expect(r1.status).toBe(201);
    const x1 = (await r1.json()).request;
    expect(x1.correctionAt).toBeNull();
    // NGHI_PHEP chỉ có correctionAt => 400
    expect((await createRaw(E13, { type: "NGHI_PHEP", correctionAt: vnDateTime(d, "15:00").toISOString(), correctionKind: "IN", reason: REASON })).status).toBe(400);
    // BO_SUNG_CONG kèm fromTime/toTime: khoảng lưu phải theo correctionAt
    const r2 = await createRaw(E13, { type: "BO_SUNG_CONG", correctionAt: vnDateTime(d, "16:00").toISOString(), correctionKind: "OUT", fromTime: vnDateTime(d, "08:00").toISOString(), toTime: vnDateTime(d, "17:00").toISOString(), reason: REASON });
    expect(r2.status).toBe(201);
    const x2 = (await r2.json()).request;
    expect(new Date(x2.fromTime).toISOString()).toBe(vnDateTime(d, "16:00").toISOString());
    expect(new Date(x2.toTime).getTime() - new Date(x2.fromTime).getTime()).toBe(60_000);
  });
  it("trùng đơn (±15 phút), sau từ chối được tạo lại", async () => {
    const d = pastWorkday(2);
    const r = await createOk(E13, vnDateTime(d, "08:00"), "IN");
    expect((await create(E13, vnDateTime(d, "08:10"), "OUT")).status).toBe(400);
    expect((await create(E13, vnDateTime(d, "17:05"), "OUT")).status).toBe(201);
    await decide(await sessionCookie((await byCode("NV006")).id), r.id, "REJECT");
    expect((await create(E13, vnDateTime(d, "08:00"), "IN")).status).toBe(201);
  });
  it("[race] 2 đơn trùng tạo đồng thời => chỉ 1 đơn", async () => {
    const at = vnDateTime(pastWorkday(3), "10:00");
    const rs = await Promise.all([create(E13, at, "IN"), create(E13, at, "IN")]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
  });
});

describe("QC-C2 chấm tay — trạng thái đơn", () => {
  it("PENDING / REJECTED / CANCELLED / hủy đơn đã duyệt", async () => {
    const d = pastWorkday(1);
    const p = await createOk(E9, vnDateTime(d, "11:00"), "IN");
    expect((await execute(H, p.id)).status).toBe(400);
    expect((await execute(A, p.id)).status).toBe(400);
    const c = await createOk(E9, vnDateTime(d, "12:00"), "OUT");
    expect((await cancel(E9, c.id)).status).toBe(200);
    expect((await decide(MKT, c.id)).status).toBe(400);
    expect((await execute(H, c.id)).status).toBe(400);
    const rj = await createOk(E9, vnDateTime(d, "13:00"), "IN");
    expect((await decide(MKT, rj.id, "REJECT")).status).toBe(200);
    expect((await execute(A, rj.id)).status).toBe(400);
    const ap = await createOk(E9, vnDateTime(d, "14:00"), "OUT");
    expect((await decide(MKT, ap.id)).status).toBe(200);
    expect((await cancel(E9, ap.id)).status).toBe(400);
    for (const id of [p.id, c.id, rj.id]) expect(await logsOf(id)).toBe(0);
  });
  it("[race] 2 lần chấm tay đồng thời => đúng 1 log", async () => {
    const r = await createOk(E9, vnDateTime(pastWorkday(2), "15:00"), "OUT");
    await decide(MKT, r.id);
    const rs = await Promise.all([execute(H, r.id), execute(A, r.id), execute(H, r.id)]);
    expect(rs.filter((x) => x.status === 200).length).toBe(1);
    expect(await logsOf(r.id)).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CORRECTION_EXECUTE", entityId: String(r.id) } })).toBe(1);
  });
});

describe("QC-C3 chấm tay — ai được làm", () => {
  it("không ai tự chấm tay đơn của mình (NV/QL/NS/QT); QL, NV không chấm cho người khác", async () => {
    const d = pastWorkday(3);
    // Nhân viên
    const re = await createOk(E15, vnDateTime(d, "17:40"));
    await decide(MKD, re.id);
    expect((await execute(E15, re.id)).status).toBe(403);
    expect((await execute(MKD, re.id)).status).toBe(403);
    expect((await execute(E9, re.id)).status).toBe(403);
    // Quản lý: Nhân sự duyệt, quản lý không tự chấm
    const rm = await createOk(MKD, vnDateTime(d, "17:41"));
    expect((await decide(H, rm.id)).status).toBe(200);
    expect((await execute(MKD, rm.id)).status).toBe(403);
    // Nhân sự: Quản trị duyệt, Nhân sự không tự chấm
    const rh = await createOk(H, vnDateTime(d, "17:42"));
    expect((await decide(A, rh.id)).status).toBe(200);
    expect((await execute(H, rh.id)).status).toBe(403);
    expect((await execute(A, rh.id)).status).toBe(200);
    // Quản trị: Nhân sự duyệt + chấm; Quản trị không tự chấm
    const ra = await createOk(A, vnDateTime(d, "17:43"));
    expect((await decide(A, ra.id)).status).toBe(403);
    expect((await decide(H, ra.id)).status).toBe(200);
    expect((await execute(A, ra.id)).status).toBe(403);
    expect((await execute(H, ra.id)).status).toBe(200);
  });
});

describe("QC-C4 chấm tay — giờ chấm", () => {
  it("lệch >12h / tương lai / sai định dạng / note quá dài", async () => {
    const d = pastWorkday(1);
    const r = await createOk(E15, vnDateTime(d, "07:55"), "IN");
    await decide(MKD, r.id);
    expect((await execute(H, r.id, { checkTime: new Date(vnDateTime(d, "07:55").getTime() + 12 * 3600_000 + 60_000).toISOString() })).status).toBe(400);
    expect((await execute(H, r.id, { checkTime: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(400);
    expect((await execute(H, r.id, { checkTime: "07:55" })).status).toBe(400);
    expect((await execute(H, r.id, { note: "x".repeat(301) })).status).toBe(400);
    expect(await logsOf(r.id)).toBe(0);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).executedAt).toBeNull();
  });
  it("[BUG?] giờ chấm tay rơi sang NGÀY CÔNG KHÁC so với đơn => phải chặn", async () => {
    const d = pastWorkday(2);
    const r = await createOk(E15, vnDateTime(d, "08:00"), "IN");
    await decide(MKD, r.id);
    const res = await execute(H, r.id, { checkTime: vnDateTime(addDays(d, -1), "21:00").toISOString() }); // lệch 11h, sang hôm trước
    const log = await prisma.attendanceLog.findFirst({ where: { sourceRequestId: r.id } });
    expect({ status: res.status, workDate: log?.workDate ?? null }).toEqual({ status: 400, workDate: null });
  });
});

describe("QC-C5 đơn chưa chấm tay KHÔNG ảnh hưởng tính công", () => {
  const shift: ShiftDef = { id: 1, name: "HC", startTime: "08:00", endTime: "17:00", breakMinutes: 60, graceLateMinutes: 5, graceEarlyMinutes: 0 };
  const d = "2026-09-14";
  const plan: DayPlan = { workDate: d, shift, isDayOff: false, isHoliday: false, source: "DEFAULT" };
  const corr = (status: string, at = "08:00") => ({ id: 99, type: "BO_SUNG_CONG", status, fromTime: vnDateTime(d, at), toTime: new Date(vnDateTime(d, at).getTime() + 60_000) });
  for (const st of ["PENDING", "APPROVED"]) {
    it(`${st}: vẫn trễ, vẫn nhắc trễ, vẫn cảnh báo vắng, không che thiếu giờ ra`, () => {
      const late = summarizeDay({ plan, logs: [{ checkTime: vnDateTime(d, "08:30"), type: "IN" }], requests: [corr(st)], now: vnDateTime(d, "23:00") });
      expect(late.isLate).toBe(true);
      expect(late.missingOut).toBe(true);
      expect(shouldSendLateReminder(true, d, shift, [corr(st)])).toBe(true);
      expect(decideAbsence({ plan, hasIn: false, enrolled: true, requests: [corr(st)], now: vnDateTime(d, "08:45"), absentAfterMinutes: 30 })).toEqual({ action: "WARN" });
      const early = summarizeDay({ plan, logs: [{ checkTime: vnDateTime(d, "07:55"), type: "IN" }, { checkTime: vnDateTime(d, "16:00"), type: "OUT" }], requests: [corr(st, "16:30")], now: vnDateTime(d, "23:00") });
      expect(early.isEarly).toBe(true);
      expect(early.otMinutes).toBe(0);
    });
  }

  it("tích hợp: đơn PENDING/APPROVED phủ giờ vào ca không xóa trễ; absenceCheck vẫn gửi ABSENT_WARNING", async () => {
    const d1 = pastWorkday(1);
    await wipeDay(e7.id, d1);
    await recordScan({ employeeId: e7.id, checkTime: vnDateTime(d1, "08:30"), source: "KIOSK" });
    const r = await createOk(E7, vnDateTime(d1, "08:00"), "IN");
    const s1 = (await summarizeRange([e7.id], d1, d1)).summaries.get(`${e7.id}|${d1}`)!;
    expect(s1.isLate).toBe(true);
    expect((await decide(MHC, r.id)).status).toBe(200);
    const s2 = (await summarizeRange([e7.id], d1, d1)).summaries.get(`${e7.id}|${d1}`)!;
    expect(s2.isLate).toBe(true);
    expect(s2.relatedRequestIds).not.toContain(r.id);

    // absenceCheck: thứ Hai tương lai, đơn BO_SUNG_CONG (chèn thẳng DB) phủ giờ vào ca
    let mon = addDays(todayVN(), 21);
    while (weekday(mon) !== 1) mon = addDays(mon, 1);
    await enrollFake(e7.id, 707);
    for (const status of ["PENDING"]) {
      await prisma.leaveRequest.create({ data: { employeeId: e7.id, type: "BO_SUNG_CONG", status, fromTime: vnDateTime(mon, "08:00"), toTime: vnDateTime(mon, "08:01"), correctionAt: vnDateTime(mon, "08:00"), correctionKind: "IN", reason: REASON } });
    }
    await absenceCheck(vnDateTime(mon, "08:45"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `absent:${e7.id}:${mon}` } })).toBe(1);
  });
});

describe("QC-C6 sau khi chấm tay", () => {
  it("thiếu giờ ra được giải quyết, giờ ra = giờ chấm tay; báo cáo đếm đúng", async () => {
    const d = pastWorkday(2);
    await wipeDay(e7.id, d);
    await recordScan({ employeeId: e7.id, checkTime: vnDateTime(d, "07:58"), source: "KIOSK" });
    const before = (await summarizeRange([e7.id], d, d)).summaries.get(`${e7.id}|${d}`)!;
    expect(before.missingOut).toBe(true);
    const rep0 = await buildAttendanceReport({ id: e7.id }, d, d);
    // Giờ ra theo CA THỰC TẾ của ngày đó (thứ Bảy của NV007 là ca nửa ngày) — không cố định 17:xx, để test không hỏng theo thứ chạy.
    const [eh, em] = before.shift!.endTime.split(":").map(Number);
    const at = (plus: number) => { const m = eh * 60 + em + plus; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
    const r = await createOk(E7, vnDateTime(d, at(30)), "OUT");
    await decide(MHC, r.id);
    expect((await buildAttendanceReport({ id: e7.id }, d, d)).summary[0].correctionCount).toBe(rep0.summary[0].correctionCount);
    expect((await execute(H, r.id, { checkTime: vnDateTime(d, at(20)).toISOString(), note: "Theo camera cổng" })).status).toBe(200);
    const after = (await summarizeRange([e7.id], d, d)).summaries.get(`${e7.id}|${d}`)!;
    expect(after.missingOut).toBe(false);
    expect(after.outTime?.toISOString()).toBe(vnDateTime(d, at(20)).toISOString());
    expect(after.status).toBe("ON_TIME");
    expect(after.isEarly).toBe(false);
    const rep = await buildAttendanceReport({ id: e7.id }, d, d);
    expect(rep.summary[0].correctionCount).toBe(rep0.summary[0].correctionCount + 1);
    expect(rep.summary[0].missingOutDays).toBe(0);
    // ngoài kỳ báo cáo thì không đếm
    expect((await buildAttendanceReport({ id: e7.id }, addDays(d, 1), addDays(d, 1))).summary[0].correctionCount).toBe(0);
    expect(vnDate(after.outTime!)).toBe(d);
  });
});

describe("QC-C7 danh sách: cờ canDecide / canExecute", () => {
  it("theo vai trò", async () => {
    const d = pastWorkday(3);
    const p = await createOk(E7, vnDateTime(d, "12:05"), "IN");
    const a = await createOk(E7, vnDateTime(d, "13:05"), "OUT");
    await decide(MHC, a.id);
    const hrOwn = await createOk(H, vnDateTime(d, "13:10"), "OUT");
    await decide(A, hrOwn.id);
    const row = (rows: Array<Record<string, unknown>>, id: number) => rows.find((x) => x.id === id);

    const hrTeam = await list(H, "scope=team");
    // v1.7.0: mặc định MANAGER_OR_HR — Nhân sự cũng duyệt được đơn chờ của phòng có quản lý.
    expect(row(hrTeam, p.id)).toMatchObject({ canDecide: true, canExecute: false });
    expect(row(hrTeam, a.id)).toMatchObject({ canDecide: false, canExecute: true });
    expect(row(hrTeam, hrOwn.id)?.canExecute ?? false).toBe(false);
    const adTeam = await list(A, "scope=team");
    expect(row(adTeam, p.id)).toMatchObject({ canDecide: true, canExecute: false });
    expect(row(adTeam, a.id)).toMatchObject({ canExecute: true });
    expect(row(adTeam, hrOwn.id)).toMatchObject({ canExecute: true });
    const mTeam = await list(MHC, "scope=team");
    expect(row(mTeam, p.id)).toMatchObject({ canDecide: true, canExecute: false });
    expect(row(mTeam, a.id)).toMatchObject({ canDecide: false, canExecute: false });
    const mOther = await list(MKD, "scope=team");
    expect(row(mOther, p.id)).toBeUndefined();
    const mine = await list(E7, "scope=team");
    expect(row(mine, p.id)).toMatchObject({ canDecide: false, canExecute: false, canCancel: true });
    expect(row(mine, a.id)).toMatchObject({ canExecute: false, canCancel: false });

    await execute(H, a.id);
    expect(row(await list(H, "scope=team"), a.id)).toMatchObject({ canExecute: false });
    expect(row(await list(H, "scope=team&view=execute"), a.id)).toBeUndefined();
  });
});

describe("QC-C8 thông báo & công khai nhóm", () => {
  const grp = (key: string) => prisma.notificationLog.count({ where: { dedupeKey: `grp:${key}` } });
  it("nhân viên: tạo → QL + NS; QL duyệt → NS + NV, không công khai; NS chấm → NV + công khai", async () => {
    const d = pastWorkday(1);
    await wipeDay(e7.id, d);
    const r = await createOk(E7, vnDateTime(d, "12:40"), "IN");
    const created = (await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `req-created:${r.id}:` } } })).map((n) => n.toEmployeeId).sort();
    expect(created).toEqual([mgrHC.id, hr.id].sort());
    await decide(MHC, r.id);
    expect((await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `corr-ready:${r.id}:` } } })).map((n) => n.toEmployeeId)).toEqual([hr.id]);
    expect((await prisma.notificationLog.findFirst({ where: { dedupeKey: `req-decided:${r.id}` } }))?.toEmployeeId).toBe(e7.id);
    expect(await grp(`req-decided:${r.id}`)).toBe(0);
    const ex = await execute(H, r.id);
    expect(ex.status, JSON.stringify(await ex.clone().json())).toBe(200);
    expect((await prisma.notificationLog.findFirst({ where: { dedupeKey: `corr-done:${r.id}` } }))?.toEmployeeId).toBe(e7.id);
    expect(await grp(`corr-exec:${r.id}`)).toBe(1);
  });
  it("NS tạo đơn: báo QT (không tự báo NS), không công khai; QT duyệt → công khai; ready chỉ tới QT", async () => {
    const d = pastWorkday(2);
    const before = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    const r = await createOk(H, vnDateTime(d, "12:40"), "IN");
    const to = (await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `req-created:${r.id}:` } } })).map((n) => n.toEmployeeId);
    expect(to).toEqual([admin.id]);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(before);
    await decide(A, r.id);
    expect(await grp(`req-decided:${r.id}`)).toBe(1);
    expect((await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `corr-ready:${r.id}:` } } })).map((n) => n.toEmployeeId)).toEqual([admin.id]);
  });
  it("QL tạo đơn: NS duyệt → công khai", async () => {
    const r = await createOk(MKT, vnDateTime(pastWorkday(2), "12:45"), "IN");
    const to = (await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `req-created:${r.id}:` } } })).map((n) => n.toEmployeeId);
    expect(to).toEqual([hr.id]);
    await decide(H, r.id);
    expect(await grp(`req-decided:${r.id}`)).toBe(1);
  });
});

describe("QC-C9 loại vào/ra của đơn", () => {
  it("[BUG?] đơn IN chấm tay sau giờ vào sẵn có => log trở thành OUT (correctionKind bị bỏ qua)", async () => {
    const d = pastWorkday(3);
    await wipeDay(e7.id, d);
    await recordScan({ employeeId: e7.id, checkTime: vnDateTime(d, "07:55"), source: "KIOSK" });
    const r = await createOk(E7, vnDateTime(d, "09:00"), "IN");
    await decide(MHC, r.id);
    const res = await execute(H, r.id);
    const log = await prisma.attendanceLog.findFirst({ where: { sourceRequestId: r.id } });
    const s = (await summarizeRange([e7.id], d, d)).summaries.get(`${e7.id}|${d}`)!;
    // Kỳ vọng: từ chối (đã có giờ vào) hoặc log là IN; thực tế: 200, log OUT 09:00 => về sớm 8 tiếng
    expect({ status: res.status, type: log?.type, isEarly: s.isEarly }).toEqual({ status: 400, type: undefined, isEarly: false });
  });
});
