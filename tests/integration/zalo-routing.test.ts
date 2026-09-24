// v1.6.0: nhiều nhóm Zalo, mỗi nhóm nhận loại tin riêng (MINH_BACH / CHAM_CONG / DON_TU), lọc theo phòng.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { absenceCheck, missingCheckout } from "@/lib/jobs";
import { announce } from "@/lib/announce";
import { announceStaff, groupsFor, parseGroupInput } from "@/lib/zalo-routing";
import { isZaloSimulated } from "@/lib/zalo-token";
import { byCode, ctx, enrollFake, req, sessionCookie } from "./helpers";

import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as cancelRoute from "@/app/api/requests/[id]/cancel/route";
import * as groupsRoute from "@/app/api/settings/zalo/groups/route";
import * as groupRoute from "@/app/api/settings/zalo/groups/[groupId]/route";

const G_ADMIN = "rt-minhbach";
const G_STAFF = "rt-nhanvien";
const G_KD = "rt-kinhdoanh";
const ALL = [G_ADMIN, G_STAFF, G_KD, "rt-new"];

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgrHC: E, mgrKD: E, lan: E, minh: E;
let A: string;
const createdRequests: number[] = [];
const createdLogs: number[] = [];

const nextWeekday = (wd: number) => {
  let d = addDays(todayVN(), 1);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
};
const staffRows = (groupId: string, keyPart: string) =>
  prisma.notificationLog.findMany({ where: { toGroupId: groupId, messageType: "GROUP_STAFF", dedupeKey: { contains: keyPart } } });
const textOf = (row: { payload: string }) => String((JSON.parse(row.payload) as { text?: string }).text ?? "");

beforeAll(async () => {
  [admin, hr, mgrHC, mgrKD, lan, minh] = await Promise.all(["NV001", "NV016", "NV002", "NV003", "NV007", "NV008"].map(byCode));
  A = await sessionCookie(admin.id);
  await prisma.zaloGroup.deleteMany({ where: { groupId: { in: ALL } } });
  await prisma.zaloGroup.createMany({
    data: [
      { groupId: G_ADMIN, name: "Minh bạch", source: "MANUAL", categories: JSON.stringify(["MINH_BACH"]) },
      { groupId: G_STAFF, name: "YDSG-NHÂN VIÊN", source: "MANUAL", categories: JSON.stringify(["CHAM_CONG", "DON_TU"]) },
      { groupId: G_KD, name: "Kinh doanh", source: "MANUAL", categories: JSON.stringify(["DON_TU"]), departmentIds: JSON.stringify([minh.departmentId]) },
    ],
  });
});

afterAll(async () => {
  await prisma.zaloGroup.deleteMany({ where: { groupId: { in: ALL } } });
  await prisma.attendanceLog.deleteMany({ where: { id: { in: createdLogs } } });
  await prisma.leaveRequest.deleteMany({ where: { id: { in: createdRequests } } });
});

describe("môi trường test", () => {
  it("không nạp .env của máy (Next.js) — Zalo luôn mô phỏng khi test, kể cả máy có khóa Zalo thật", () => {
    expect(!!process.env.ZALO_OA_APP_ID).toBe(false);
    expect(!!process.env.ZALO_OA_REFRESH_TOKEN).toBe(false);
    expect(isZaloSimulated()).toBe(true);
    expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  });
});

describe("định tuyến theo loại tin", () => {
  it("groupsFor: minh bạch bỏ qua lọc phòng; tin nhân viên lọc theo phòng", async () => {
    expect(await groupsFor("MINH_BACH")).toEqual([G_ADMIN]);
    expect(await groupsFor("DON_TU", minh.departmentId)).toEqual([G_KD, G_STAFF]);
    expect(await groupsFor("DON_TU", lan.departmentId)).toEqual([G_STAFF]);
    expect(await groupsFor("CHAM_CONG", minh.departmentId)).toEqual([G_STAFF]);
  });

  it("announce (minh bạch) chỉ vào nhóm MINH_BACH, giữ khóa cũ grp:…", async () => {
    const key = `rt-announce:${Date.now()}`;
    await announce(admin, "thử định tuyến", { key });
    const rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `grp:${key}` } } });
    expect(rows.map((r) => [r.toGroupId, r.dedupeKey])).toEqual([[G_ADMIN, `grp:${key}`]]);
  });

  it("job chạy lại sau khi thêm nhóm minh bạch thứ hai: nhóm cũ không nhận lặp, nhóm mới nhận một lần", async () => {
    const key = `rt-rerun:${Date.now()}`;
    await announce(admin, "báo lặp lại", { key });
    await prisma.zaloGroup.create({ data: { groupId: "rt-mb2", source: "MANUAL", categories: JSON.stringify(["MINH_BACH"]) } });
    try {
      await announce(admin, "báo lặp lại", { key });
      await announce(admin, "báo lặp lại", { key });
      const rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `grp:${key}` } }, orderBy: { id: "asc" } });
      expect(rows.map((r) => [r.toGroupId, r.dedupeKey])).toEqual([
        [G_ADMIN, `grp:${key}`],
        ["rt-mb2", `grp:${key}@rt-mb2`],
      ]);
    } finally {
      await prisma.zaloGroup.delete({ where: { groupId: "rt-mb2" } });
    }
  });

  it("đơn từ: gửi đơn → nhóm nhân viên (+ nhóm phòng), duyệt bởi Quản lý → cũng báo; không kèm lý do / ghi chú", async () => {
    const day = nextWeekday(4);
    const body = { type: "VE_SOM", fromTime: vnDateTime(day, "15:00").toISOString(), toTime: vnDateTime(day, "17:00").toISOString(), reason: "Việc riêng rất riêng tư XYZ" };
    const res = await requestsRoute.POST(req("/api/requests", { method: "POST", body, cookie: await sessionCookie(minh.id) }), ctx());
    expect(res.status).toBe(201);
    const { request } = await res.json();
    createdRequests.push(request.id);
    for (const g of [G_STAFF, G_KD]) {
      const rows = await staffRows(g, `req-created:${request.id}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe(`staff:req-created:${request.id}@${g}`);
      expect(textOf(rows[0])).toContain(mgrKD.name);
      expect(rows[0].payload).not.toContain("XYZ");
    }
    expect(await prisma.notificationLog.count({ where: { toGroupId: G_ADMIN, dedupeKey: { contains: `req-created:${request.id}` } } })).toBe(0);

    const ok = await decideRoute.POST(
      req(`/api/requests/${request.id}/decide`, { method: "POST", body: { action: "APPROVE", note: "Ghi chú kín ABC" }, cookie: await sessionCookie(mgrKD.id) }),
      ctx({ id: String(request.id) }),
    );
    expect(ok.status).toBe(200);
    const decided = await staffRows(G_STAFF, `req-decided:${request.id}`);
    expect(decided).toHaveLength(1);
    expect(textOf(decided[0])).toContain("DUYỆT");
    expect(textOf(decided[0])).toContain(mgrKD.name);
    expect(decided[0].payload).not.toContain("ABC");
    // Quản lý duyệt: nhóm minh bạch vẫn không nhận (luật HR/QT giữ nguyên).
    expect(await prisma.notificationLog.count({ where: { toGroupId: G_ADMIN, dedupeKey: { contains: `req-decided:${request.id}` } } })).toBe(0);
  });

  it("đơn của phòng khác không vào nhóm gắn phòng Kinh doanh", async () => {
    const day = nextWeekday(4);
    const body = { type: "VE_SOM", fromTime: vnDateTime(day, "15:00").toISOString(), toTime: vnDateTime(day, "17:00").toISOString(), reason: "Đi đón con ở trường học" };
    const res = await requestsRoute.POST(req("/api/requests", { method: "POST", body, cookie: await sessionCookie(lan.id) }), ctx());
    expect(res.status).toBe(201);
    const { request } = await res.json();
    createdRequests.push(request.id);
    expect(await staffRows(G_STAFF, `req-created:${request.id}`)).toHaveLength(1);
    expect(await staffRows(G_KD, `req-created:${request.id}`)).toHaveLength(0);
    // Tin nhân viên luôn gắn @nhóm (số nhóm đổi giữa các lần chạy job không làm gửi lặp).
    expect((await staffRows(G_STAFF, `req-created:${request.id}`))[0].dedupeKey).toBe(`staff:req-created:${request.id}@${G_STAFF}`);
    // Tự hủy đơn đang chờ → nhóm đơn từ được báo (tin "đang chờ duyệt" không treo).
    const cancel = await cancelRoute.POST(req(`/api/requests/${request.id}/cancel`, { method: "POST", cookie: await sessionCookie(lan.id) }), ctx({ id: String(request.id) }));
    expect(cancel.status).toBe(200);
    const cancelled = await staffRows(G_STAFF, `req-cancelled:${request.id}`);
    expect(cancelled).toHaveLength(1);
    expect(textOf(cancelled[0])).toContain("hủy");
  });
});

describe("chấm công", () => {
  const monday = nextWeekday(1);
  it("chưa chấm vào → 1 tin/người (chạy lại không trùng); hết ca → vắng không phép; có đơn nghỉ → không báo", async () => {
    for (const e of [lan, minh, mgrHC]) await enrollFake(e.id, e.id + 700);
    // Minh đã gửi đơn bổ sung công (máy không nhận mặt) → không bị báo "vắng không phép".
    const corr = await prisma.leaveRequest.create({
      data: { employeeId: minh.id, type: "BO_SUNG_CONG", fromTime: vnDateTime(monday, "08:01"), toTime: vnDateTime(monday, "08:02"), correctionAt: vnDateTime(monday, "08:01"), correctionKind: "IN", reason: "Máy không nhận khuôn mặt", status: "PENDING" },
    });
    createdRequests.push(corr.id);
    const leave = await prisma.leaveRequest.create({
      data: { employeeId: mgrHC.id, type: "NGHI_PHEP", fromTime: vnDateTime(monday, "08:00"), toTime: vnDateTime(monday, "17:00"), reason: "Nghỉ phép năm có duyệt", status: "APPROVED", approverId: hr.id, decidedAt: new Date() },
    });
    createdRequests.push(leave.id);

    await absenceCheck(vnDateTime(monday, "09:00"));
    await absenceCheck(vnDateTime(monday, "09:10"));
    const warn = await staffRows(G_STAFF, `absent:${lan.id}:${monday}`);
    expect(warn).toHaveLength(1);
    expect(textOf(warn[0])).toContain("Chưa chấm giờ vào");
    expect(await staffRows(G_STAFF, `absent:${mgrHC.id}:${monday}`)).toHaveLength(0);
    expect(await staffRows(G_KD, `absent:${minh.id}:${monday}`)).toHaveLength(0); // nhóm Kinh doanh chỉ nhận đơn từ

    await absenceCheck(vnDateTime(monday, "17:30"));
    const final = await staffRows(G_STAFF, `absent-final:${lan.id}:${monday}`);
    expect(final).toHaveLength(1);
    expect(textOf(final[0])).toContain("Vắng không phép");
    expect(await staffRows(G_STAFF, `absent-final:${mgrHC.id}:${monday}`)).toHaveLength(0);
    expect(await staffRows(G_STAFF, `absent-final:${minh.id}:${monday}`)).toHaveLength(0);
  });

  it("quên chấm giờ ra → tin vào nhóm chấm công", async () => {
    const day = nextWeekday(2);
    const r = await recordScan({ employeeId: minh.id, checkTime: vnDateTime(day, "07:58"), source: "MANUAL", note: "test định tuyến", createdById: admin.id });
    if ("log" in r && r.log) createdLogs.push(r.log.id);
    await missingCheckout(vnDateTime(day, "23:00"));
    const rows = await staffRows(G_STAFF, `missing-out:${minh.id}|${day}`);
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0])).toContain("Quên chấm giờ ra");
  });
});

describe("API nhóm (Quản trị)", () => {
  it("dán link chat tách được gid; ID toàn số (oaid) → 400; HR → 403", async () => {
    expect(parseGroupInput("https://oa.zalo.me/chat?gid=712b67d35bb3b2edeba2&oaid=4184792993048491848")).toEqual({ groupId: "712b67d35bb3b2edeba2" });
    expect("error" in parseGroupInput("4184792993048491848")).toBe(true);
    expect("error" in parseGroupInput("https://oa.zalo.me/chat?gid=%E0%A4%A")).toBe(true); // mã % hỏng: không ném lỗi 500
    const bad = await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: "4184792993048491848" } }), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("ID của OA");
    const ok = await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: "https://oa.zalo.me/chat?gid=rt-new&oaid=1" } }), ctx());
    expect(ok.status).toBe(200);
    expect(await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: "rt-new" } })).toMatchObject({ categories: "[]", source: "MANUAL" });
    const hrCookie = await sessionCookie(hr.id);
    expect((await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: hrCookie, body: { groupId: "rt-new" } }), ctx())).status).toBe(403);
  });

  it("PATCH loại tin + phòng: sai mã → 400, phòng không tồn tại → 400, hợp lệ → lưu + báo nhóm minh bạch; HR → 403", async () => {
    const patch = (body: unknown, cookie = A) =>
      groupRoute.PATCH(req(`/api/settings/zalo/groups/rt-new`, { method: "PATCH", cookie, body }), ctx({ groupId: "rt-new" }));
    expect((await patch({ categories: ["KHONG_CO"] })).status).toBe(400);
    expect((await patch({ departmentIds: [999999] })).status).toBe(400);
    const ok = await patch({ categories: ["DON_TU", "CHAM_CONG"], departmentIds: [lan.departmentId] });
    expect(ok.status).toBe(200);
    expect(await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: "rt-new" } })).toMatchObject({
      categories: JSON.stringify(["DON_TU", "CHAM_CONG"]),
      departmentIds: JSON.stringify([lan.departmentId]),
    });
    expect(await prisma.notificationLog.count({ where: { toGroupId: G_ADMIN, dedupeKey: { startsWith: "grp:zalo-routing:rt-new:" } } })).toBe(1);
    // Chỉ gửi trường categories: phòng giữ nguyên.
    await patch({ categories: [] });
    expect(await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: "rt-new" } })).toMatchObject({ categories: "[]", departmentIds: JSON.stringify([lan.departmentId]) });
    expect((await patch({ categories: ["DON_TU"] }, await sessionCookie(hr.id))).status).toBe(403);
    expect((await groupRoute.PATCH(req(`/api/settings/zalo/groups/khong-co`, { method: "PATCH", cookie: A, body: {} }), ctx({ groupId: "khong-co" }))).status).toBe(404);
  });

  it("DELETE nhóm: HR → 403, id lạ → 404; xóa xong ngừng nhận tin, có tin báo vào nhóm + nhật ký + tin minh bạch", async () => {
    const gid = "rt-new";
    await prisma.zaloGroup.upsert({
      where: { groupId: gid },
      create: { groupId: gid, name: "Nhóm sắp xóa", source: "MANUAL", categories: JSON.stringify(["CHAM_CONG"]) },
      update: { name: "Nhóm sắp xóa", categories: JSON.stringify(["CHAM_CONG"]) },
    });
    await prisma.zaloGroup.updateMany({ where: { groupId: G_ADMIN }, data: { categories: JSON.stringify(["MINH_BACH"]) } });
    expect(await groupsFor("CHAM_CONG", lan.departmentId)).toContain(gid);

    const del = (groupId: string, cookie = A) => groupRoute.DELETE(req(`/api/settings/zalo/groups/${groupId}`, { method: "DELETE", cookie }), ctx({ groupId }));
    expect((await del(gid, await sessionCookie(hr.id))).status).toBe(403);
    expect((await del("khong-co-nhom-nay")).status).toBe(404);

    const ok = await del(gid);
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect(await prisma.zaloGroup.count({ where: { groupId: gid } })).toBe(0);
    expect(await groupsFor("CHAM_CONG", lan.departmentId)).not.toContain(gid);
    // Tin báo gửi vào chính nhóm bị xóa + tin minh bạch cho nhóm quản trị + nhật ký.
    expect(await prisma.notificationLog.count({ where: { toGroupId: gid, dedupeKey: { startsWith: `grp:zalo-disconnect:${gid}:` } } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { toGroupId: G_ADMIN, dedupeKey: { startsWith: `grp:zalo-delete:${gid}:` } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "ZALO_GROUP_ROUTING", entityId: gid, detail: { contains: '"deleted":true' } } })).toBeGreaterThan(0);
  });

  it("nhóm đã xóa mà nhắn lại cho OA (webhook) thì hiện lại nhưng KHÔNG nhận tin", async () => {
    const gid = "rt-new";
    await prisma.zaloGroup.deleteMany({ where: { groupId: gid } });
    // Webhook chỉ upsert khung nhóm — không gán loại tin nào (giống src/app/api/zalo/webhook/route.ts:61).
    await prisma.zaloGroup.upsert({ where: { groupId: gid }, create: { groupId: gid, source: "WEBHOOK" }, update: {} });
    const again = await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: gid } });
    expect(again).toMatchObject({ source: "WEBHOOK", categories: "[]" });
    expect(await groupsFor("CHAM_CONG", lan.departmentId)).not.toContain(gid);
  });

  it("không nhóm nào nhận loại tin → không ghi log", async () => {
    await prisma.zaloGroup.updateMany({ where: { groupId: { in: ALL } }, data: { categories: "[]" } });
    const key = `rt-none:${Date.now()}`;
    await announceStaff({ category: "DON_TU", employeeId: lan.id, icon: "📝", text: "x", key });
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { contains: key } } })).toBe(0);
  });
});
