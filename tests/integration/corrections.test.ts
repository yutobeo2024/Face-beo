import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { missingCheckout } from "@/lib/jobs";
import { buildAttendanceReport } from "@/lib/reports";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as executeRoute from "@/app/api/requests/[id]/execute/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgrKD: E, mgrKT: E, emp: E;
let A: string, H: string, MKD: string, MKT: string, EMP: string;

const create = async (cookie: string, correctionAt: Date, kind: "IN" | "OUT" = "OUT") =>
  requestsRoute.POST(req("/api/requests", { method: "POST", cookie, body: { type: "BO_SUNG_CONG", correctionAt: correctionAt.toISOString(), correctionKind: kind, reason: "Quên chấm công do máy đông người" } }), ctx());
const decide = (cookie: string, id: number, action = "APPROVE") =>
  decideRoute.POST(req(`/api/requests/${id}/decide`, { method: "POST", cookie, body: { action, note: action === "REJECT" ? "Không hợp lệ" : undefined } }), ctx({ id: String(id) }));
const execute = (cookie: string, id: number, body: object = {}) =>
  executeRoute.POST(req(`/api/requests/${id}/execute`, { method: "POST", cookie, body }), ctx({ id: String(id) }));

/** Ngày làm việc gần nhất trong quá khứ (tránh Chủ nhật), cách hôm nay `back` ngày trở lên. */
/** Ngày đã qua, không rơi Chủ nhật, và LUÔN nằm trong hạn bổ sung công 3 ngày — gặp Chủ nhật thì tiến về phía hôm nay,
 *  lùi tiếp sẽ quá hạn và API từ chối (lộ ra vào thứ Tư: hôm nay − 3 = Chủ nhật). */
function pastWorkday(back: number) {
  let d = addDays(todayVN(), -back);
  while (weekday(d) === 7) d = addDays(d, 1);
  return d;
}

beforeAll(async () => {
  // Cô lập với file test khác dùng chung DB: xóa đơn bổ sung công + log sinh ra từ đơn.
  await prisma.attendanceLog.deleteMany({ where: { sourceRequestId: { not: null } } });
  await prisma.leaveRequest.deleteMany({ where: { type: "BO_SUNG_CONG" } });
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  mgrKD = await byCode("NV003");
  mgrKT = await byCode("NV004");
  emp = await byCode("NV008"); // Kinh doanh, quản lý là NV003
  [A, H, MKD, MKT, EMP] = await Promise.all([admin, hr, mgrKD, mgrKT, emp].map((e) => sessionCookie(e.id)));
});

describe("đơn bổ sung công — tạo đơn", () => {
  it("chặn giờ ở tương lai và quá 3 ngày", async () => {
    expect((await create(EMP, new Date(Date.now() + 3600_000))).status).toBe(400);
    expect((await create(EMP, vnDateTime(addDays(todayVN(), -5), "17:00"))).status).toBe(400);
  });

  it("tạo đơn báo cho quản lý phòng VÀ Nhân sự", async () => {
    const res = await create(EMP, vnDateTime(pastWorkday(1), "17:31"));
    expect(res.status).toBe(201);
    const { request } = await res.json();
    expect(request.correctionKind).toBe("OUT");
    const keys = (await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `req-created:${request.id}:` } } })).map((n) => n.toEmployeeId);
    expect(keys).toContain(mgrKD.id);
    expect(keys).toContain(hr.id);
    // Trùng thời điểm (±15 phút) với đơn đang chờ => 400
    expect((await create(EMP, vnDateTime(pastWorkday(1), "17:40"))).status).toBe(400);
  });
});

describe("đơn bổ sung công — duyệt rồi chấm tay", () => {
  it("luồng Nhân viên: quản lý duyệt → Nhân sự chấm tay → log MANUAL gắn đơn", async () => {
    const day = pastWorkday(2);
    const { request } = await (await create(EMP, vnDateTime(day, "17:20"))).json();

    // Chưa duyệt thì chưa chấm tay được
    expect((await execute(H, request.id)).status).toBe(400);
    // Quản lý phòng khác không duyệt được; quản lý phòng mình duyệt
    expect((await decide(MKT, request.id)).status).toBe(403);
    expect((await decide(MKD, request.id)).status).toBe(200);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `corr-ready:${request.id}:${hr.id}` } })).toBe(1);
    // Duyệt xong chưa sinh log
    expect(await prisma.attendanceLog.count({ where: { sourceRequestId: request.id } })).toBe(0);

    // Quản lý không có quyền chấm tay; nhân viên không tự chấm tay
    expect((await execute(MKD, request.id)).status).toBe(403);
    expect((await execute(EMP, request.id)).status).toBe(403);

    const groups = await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } });
    const res = await execute(H, request.id);
    expect(res.status).toBe(200);
    const log = await prisma.attendanceLog.findFirstOrThrow({ where: { sourceRequestId: request.id } });
    expect(log.source).toBe("MANUAL");
    expect(log.createdById).toBe(hr.id);
    expect(log.workDate).toBe(day);
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(r.executedById).toBe(hr.id);
    expect(r.executedLogId).toBe(log.id);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `corr-done:${request.id}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT" } })).toBe(groups + 1);
    expect(await prisma.auditLog.count({ where: { action: "CORRECTION_EXECUTE", entityId: String(request.id) } })).toBe(1);

    // Không chấm tay lần hai
    expect((await execute(H, request.id)).status).toBe(400);
  });

  it("chỉnh giờ: tối đa 60 phút, cùng ngày, bắt buộc ghi chú", async () => {
    // NV015 (Kinh doanh) không có log mẫu => lần bổ sung "vào" sẽ là IN.
    const e = await byCode("NV015");
    const cookie = await sessionCookie(e.id);
    const day = pastWorkday(1);
    const cr = await create(cookie, vnDateTime(day, "08:02"), "IN");
    expect(cr.status, JSON.stringify(await cr.clone().json())).toBe(201);
    const { request } = await cr.json();
    await decide(MKD, request.id);
    expect((await execute(H, request.id, { checkTime: vnDateTime(addDays(day, -1), "08:00").toISOString(), note: "Lệch sang hôm trước" })).status).toBe(400);
    expect((await execute(H, request.id, { checkTime: vnDateTime(day, "09:30").toISOString(), note: "Lệch quá 60 phút" })).status).toBe(400);
    expect((await execute(H, request.id, { checkTime: vnDateTime(day, "07:58").toISOString() })).status).toBe(400); // thiếu ghi chú
    expect((await execute(H, request.id, { checkTime: vnDateTime(day, "07:58").toISOString(), note: "Theo camera an ninh" })).status).toBe(200);
    const log = await prisma.attendanceLog.findFirstOrThrow({ where: { sourceRequestId: request.id } });
    expect(log.checkTime.toISOString()).toBe(vnDateTime(day, "07:58").toISOString());
    expect(log.type).toBe("IN");
  });

  it("giờ bổ sung tạo ra sai loại vào/ra thì hủy toàn bộ, không để lại log, đơn vẫn chờ chấm tay", async () => {
    // NV008 đã có log vào/ra mẫu cả ngày => bổ sung "vào" lúc 10:00 sẽ thành lần RA => không khớp.
    const day = pastWorkday(3);
    const { request } = await (await create(EMP, vnDateTime(day, "10:00"), "IN")).json();
    await decide(MKD, request.id);
    const before = await prisma.attendanceLog.count({ where: { employeeId: emp.id } });
    expect((await execute(H, request.id)).status).toBe(400);
    expect(await prisma.attendanceLog.count({ where: { employeeId: emp.id } })).toBe(before);
    const r = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(r.executedAt).toBeNull();
    expect(r.executedLogId).toBeNull();
  });

  it("hai người chấm tay cùng lúc chỉ tạo đúng một log", async () => {
    const { request } = await (await create(EMP, vnDateTime(pastWorkday(2), "17:45"))).json();
    await decide(MKD, request.id);
    const [a, b] = await Promise.all([execute(H, request.id), execute(A, request.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await prisma.attendanceLog.count({ where: { sourceRequestId: request.id } })).toBe(1);
  });

  it("đơn bị từ chối thì không chấm tay được", async () => {
    const { request } = await (await create(EMP, vnDateTime(pastWorkday(3), "12:00"), "IN")).json();
    await decide(MKD, request.id, "REJECT");
    expect((await execute(H, request.id)).status).toBe(400);
  });

  it("luồng Quản lý: Nhân sự vừa duyệt vừa chấm tay", async () => {
    // Bảo đảm ngày đó quản lý đã có giờ vào (dữ liệu mẫu có thể cho vắng ngẫu nhiên).
    await recordScan({ employeeId: mgrKT.id, checkTime: vnDateTime(pastWorkday(1), "06:50"), source: "MANUAL", createdById: admin.id });
    const { request } = await (await create(MKT, vnDateTime(pastWorkday(1), "17:10"))).json();
    expect((await decide(MKD, request.id)).status).toBe(403);
    expect((await decide(H, request.id)).status).toBe(200);
    expect((await execute(H, request.id)).status).toBe(200);
  });

  it("luồng Nhân sự: Quản trị duyệt và chấm tay; Nhân sự không tự chấm tay", async () => {
    const { request } = await (await create(H, vnDateTime(pastWorkday(1), "17:05"))).json();
    expect((await decide(H, request.id)).status).toBe(403);
    expect((await decide(A, request.id)).status).toBe(200);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `corr-ready:${request.id}:${admin.id}` } })).toBe(1);
    expect((await execute(H, request.id)).status).toBe(403);
    expect((await execute(A, request.id)).status).toBe(200);
  });

  it("danh sách 'Chờ chấm tay' của Nhân sự chỉ có đơn đã duyệt, chưa thực hiện", async () => {
    const { request } = await (await create(EMP, vnDateTime(pastWorkday(2), "12:30"), "IN")).json();
    await decide(MKD, request.id);
    const list = await (await requestsRoute.GET(req("/api/requests?scope=team&view=execute", { cookie: H }), ctx())).json();
    const row = list.requests.find((x: { id: number }) => x.id === request.id);
    expect(row?.canExecute).toBe(true);
    expect(list.requests.every((x: { type: string; status: string; executedAt: string | null }) => x.type === "BO_SUNG_CONG" && x.status === "APPROVED" && !x.executedAt)).toBe(true);
  });
});

describe("liên kết với chấm công & báo cáo", () => {
  it("job thiếu giờ ra nhắc nhân viên tạo đơn bổ sung công", async () => {
    let monday = addDays(todayVN(), 14);
    while (weekday(monday) !== 1) monday = addDays(monday, 1);
    const e = await byCode("NV007");
    await recordScan({ employeeId: e.id, checkTime: vnDateTime(monday, "07:59"), source: "MANUAL", createdById: admin.id });
    await missingCheckout(vnDateTime(monday, "23:30"));
    const n = await prisma.notificationLog.findFirst({ where: { dedupeKey: `missing-out:${e.id}|${monday}` } });
    expect(n?.messageType).toBe("MISSING_OUT_NUDGE");
    expect(JSON.parse(n!.payload).text).toContain("BO_SUNG_CONG");
    await missingCheckout(vnDateTime(monday, "23:59"));
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `missing-out:${e.id}|${monday}` } })).toBe(1);
  });

  it("bảng công đếm số lần bổ sung công đã thực hiện", async () => {
    const r = await buildAttendanceReport({ id: emp.id }, addDays(todayVN(), -4), todayVN());
    expect(r.summary[0].correctionCount).toBeGreaterThanOrEqual(2);
  });
});
