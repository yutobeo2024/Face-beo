import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { addDays, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { absenceCheck } from "@/lib/jobs";
import { notifyLateIfNeeded } from "@/lib/notify";
import { registerServerLiveness } from "@/lib/liveness";
import { modelPath } from "@/lib/liveness-l2";
import { __setZaloTestHooks, refreshZaloToken } from "@/lib/zalo-token";
import { byCode, ctx, enrollFake, fakeEmbedding, pairedDevice, readXlsx, req, scanPayload, sessionCookie } from "./helpers";

import * as dashboardRoute from "@/app/api/dashboard/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as attendanceRoute from "@/app/api/attendance/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as scanRoute from "@/app/api/kiosk/scan/route";
import * as pingRoute from "@/app/api/kiosk/ping/route";
import * as pairRoute from "@/app/api/kiosk/pair/route";
import * as revokeRoute from "@/app/api/devices/[id]/revoke/route";
import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as xlsxRoute from "@/app/api/reports/attendance.xlsx/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as cronRoute from "@/app/api/cron/[job]/route";
import * as rosterRoute from "@/app/api/roster/route";
import * as registerRoute from "@/app/api/roster/register/route";

const frames = (v: number) => Array.from({ length: 5 }, () => ({ real: v, live: v }));
const nextWeekday = (from: string, wd: number) => {
  let d = addDays(from, 1);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
};

let admin: Awaited<ReturnType<typeof byCode>>;
let managerKD: Awaited<ReturnType<typeof byCode>>; // Kinh doanh
let employee: Awaited<ReturnType<typeof byCode>>; // NV008, Kinh doanh
let otherDeptEmployee: Awaited<ReturnType<typeof byCode>>; // NV009, Kỹ thuật

beforeAll(async () => {
  resetRateLimits();
  admin = await byCode("NV001");
  managerKD = await byCode("NV003");
  employee = await byCode("NV008");
  otherDeptEmployee = await byCode("NV009");
});

describe("phân quyền", () => {
  it("EMPLOYEE gọi API admin nhận 403", async () => {
    const cookie = await sessionCookie(employee.id);
    expect((await dashboardRoute.GET(req("/api/dashboard", { cookie }), ctx())).status).toBe(403);
    expect((await employeesRoute.GET(req("/api/employees", { cookie }), ctx())).status).toBe(403);
    expect((await settingsRoute.GET(req("/api/settings", { cookie }), ctx())).status).toBe(403);
  });
  it("chưa đăng nhập nhận 401", async () => {
    expect((await dashboardRoute.GET(req("/api/dashboard"), ctx())).status).toBe(401);
  });
  it("MANAGER không đọc được dữ liệu phòng khác", async () => {
    const cookie = await sessionCookie(managerKD.id);
    const r = await employeeRoute.GET(req(`/api/employees/${otherDeptEmployee.id}`, { cookie }), ctx({ id: String(otherDeptEmployee.id) }));
    expect(r.status).toBe(403);
    const own = await employeeRoute.GET(req(`/api/employees/${employee.id}`, { cookie }), ctx({ id: String(employee.id) }));
    expect(own.status).toBe(200);
    const list = await (await employeesRoute.GET(req("/api/employees", { cookie }), ctx())).json();
    expect(list.employees.every((e: { departmentId: number }) => e.departmentId === managerKD.departmentId)).toBe(true);
    const att = await (
      await attendanceRoute.GET(req(`/api/attendance?departmentId=${otherDeptEmployee.departmentId}&from=${addDays(todayVN(), -3)}&to=${todayVN()}`, { cookie }), ctx())
    ).json();
    expect(att.rows).toHaveLength(0);
    // MANAGER không có quyền ADMIN
    expect((await settingsRoute.GET(req("/api/settings", { cookie }), ctx())).status).toBe(403);
  });
  it("khóa đăng nhập sau 5 lần sai", async () => {
    resetRateLimits();
    const body = { login: "NV015", password: "sai-mat-khau" };
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await loginRoute.POST(req("/api/auth/login", { method: "POST", body }), ctx())).status);
    expect(statuses.slice(0, 4).every((s) => s === 401)).toBe(true);
    expect(statuses[4]).toBe(423);
    const ok = await loginRoute.POST(req("/api/auth/login", { method: "POST", body: { login: "NV015", password: "123456" } }), ctx());
    expect(ok.status).toBe(423);
    resetRateLimits();
  });
});

describe("kiosk", () => {
  it("không có token thiết bị nhận 401; token đã thu hồi nhận 401", async () => {
    const body = { ...scanPayload(fakeEmbedding(1)), frames: frames(0.9), clientEventId: randomUUID(), capturedAt: new Date().toISOString() };
    expect((await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body }), ctx())).status).toBe(401);
    const { device, cookie } = await pairedDevice("Kiosk thu hồi");
    expect((await pingRoute.GET(req("/api/kiosk/ping", { cookie }), ctx())).status).toBe(200);
    const adminCookie = await sessionCookie(admin.id);
    expect((await revokeRoute.POST(req(`/api/devices/${device.id}/revoke`, { method: "POST", cookie: adminCookie }), ctx({ id: String(device.id) }))).status).toBe(200);
    expect((await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).status).toBe(401);
    expect((await pingRoute.GET(req("/api/kiosk/ping", { cookie }), ctx())).status).toBe(401);
  });

  it("ghép thiết bị bằng mã 6 số", async () => {
    const d = await prisma.kioskDevice.create({ data: { name: "Kiosk ghép", pairCode: "654321", pairExpiresAt: new Date(Date.now() + 60_000) } });
    const r = await pairRoute.POST(req("/api/kiosk/pair", { method: "POST", body: { code: "654321" } }), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("fb_kiosk=");
    const after = await prisma.kioskDevice.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.tokenHash).toBeTruthy();
    expect(after.pairCode).toBeNull();
  });

  it("quét giả lập bằng embedding mẫu: nhận đúng người; cùng clientEventId chỉ tạo một log", async () => {
    const target = await byCode("NV007");
    const base = await enrollFake(target.id, 7);
    await enrollFake((await byCode("NV010")).id, 10);
    const { cookie } = await pairedDevice("Kiosk quét");
    const clientEventId = randomUUID();
    const body = { ...scanPayload(base), frames: frames(0.95), clientEventId, capturedAt: new Date().toISOString() };
    const r1 = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).json();
    expect(r1.result).toBe("OK");
    expect(r1.employee.code).toBe("NV007");
    const r2 = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).json();
    expect(r2.result).toBe("OK");
    expect(r2.duplicateEvent).toBe(true);
    expect(await prisma.attendanceLog.count({ where: { clientEventId } })).toBe(1);
    // Quét lại trong 120 giây với sự kiện mới => không tạo log
    const r3 = await (
      await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body: { ...body, clientEventId: randomUUID() }, cookie }), ctx())
    ).json();
    expect(r3.result).toBe("DUPLICATE");
  });

  it("liveness thấp bị từ chối và ghi AuditLog; cờ client bị bỏ qua", async () => {
    const target = await byCode("NV007");
    const base = await enrollFake(target.id, 7);
    const { cookie } = await pairedDevice("Kiosk giả mạo");
    const before = await prisma.auditLog.count({ where: { action: "SCAN_SPOOF_REJECTED" } });
    const body = { ...scanPayload(base), frames: frames(0.2), clientEventId: randomUUID(), capturedAt: new Date().toISOString(), verified3D: true };
    const r = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).json();
    expect(r.result).toBe("REJECTED_SPOOF");
    expect(await prisma.auditLog.count({ where: { action: "SCAN_SPOOF_REJECTED" } })).toBe(before + 1);
  });

  it("khuôn mặt lạ => không nhận ra", async () => {
    const { cookie } = await pairedDevice("Kiosk lạ");
    const body = { ...scanPayload(Array.from({ length: 512 }, (_, i) => Math.sin(i * 7.3))), frames: frames(0.95), clientEventId: randomUUID(), capturedAt: new Date().toISOString() };
    const r = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", body, cookie }), ctx())).json();
    expect(r.result).toBe("NO_MATCH");
  });
});

describe("job absence-check", () => {
  it("chạy hai lần liên tiếp chỉ sinh một NotificationLog cho mỗi người vắng", async () => {
    // Nhân viên ca cố định đã enroll, thứ Hai tới lúc 09:00 chưa chấm vào.
    const monday = nextWeekday(todayVN(), 1);
    for (const code of ["NV002", "NV003", "NV007", "NV008"]) await enrollFake((await byCode(code)).id, Number(code.slice(2)));
    const now = vnDateTime(monday, "09:00");
    const r1 = await absenceCheck(now);
    const count1 = await prisma.notificationLog.count({ where: { messageType: "ABSENT_WARNING", dedupeKey: { endsWith: `:${monday}` } } });
    const r2 = await absenceCheck(now);
    const count2 = await prisma.notificationLog.count({ where: { messageType: "ABSENT_WARNING", dedupeKey: { endsWith: `:${monday}` } } });
    expect(r1.warned).toBeGreaterThan(0);
    expect(r2.warned).toBe(0);
    expect(count2).toBe(count1);
    const perPerson = await prisma.notificationLog.groupBy({
      by: ["toEmployeeId"],
      where: { messageType: "ABSENT_WARNING", dedupeKey: { endsWith: `:${monday}` } },
      _count: true,
    });
    expect(perPerson.every((p) => p._count === 1)).toBe(true);
    expect(await prisma.notificationLog.count({ where: { messageType: "ABSENT_DIGEST", dedupeKey: { contains: `:${monday}:` } } })).toBeGreaterThan(0);
  });

  it("API cron yêu cầu CRON_SECRET", async () => {
    expect((await cronRoute.POST(req("/api/cron/missing-checkout", { method: "POST" }), ctx({ job: "missing-checkout" }))).status).toBe(401);
    const ok = await cronRoute.POST(
      req("/api/cron/missing-checkout", { method: "POST", headers: { "x-cron-secret": "test-cron-secret" } }),
      ctx({ job: "missing-checkout" }),
    );
    expect(ok.status).toBe(200);
  });
});

describe("thông báo đơn và nhắc trễ", () => {
  it("tạo đơn sinh tin cho quản lý; duyệt đơn sinh tin cho nhân viên", async () => {
    const cookie = await sessionCookie(employee.id);
    const day = nextWeekday(todayVN(), 3);
    const body = {
      type: "VE_SOM",
      fromTime: vnDateTime(day, "16:00").toISOString(),
      toTime: vnDateTime(day, "17:00").toISOString(),
      reason: "Đi đón con ở trường học",
    };
    const res = await requestsRoute.POST(req("/api/requests", { method: "POST", body, cookie }), ctx());
    expect(res.status).toBe(201);
    const { request } = await res.json();
    const created = await prisma.notificationLog.findUnique({ where: { dedupeKey: `req-created:${request.id}:${managerKD.id}` } });
    expect(created?.toEmployeeId).toBe(managerKD.id);
    expect(created?.status).toBe("SKIPPED_NO_ZALO");

    // Trùng thời gian cùng loại => 400
    expect((await requestsRoute.POST(req("/api/requests", { method: "POST", body, cookie }), ctx())).status).toBe(400);
    // Nhân viên không tự duyệt được
    const self = await decideRoute.POST(req(`/api/requests/${request.id}/decide`, { method: "POST", body: { action: "APPROVE" }, cookie }), ctx({ id: String(request.id) }));
    expect(self.status).toBe(403);
    // Từ chối bắt buộc ghi chú
    const mCookie = await sessionCookie(managerKD.id);
    const noNote = await decideRoute.POST(req(`/api/requests/${request.id}/decide`, { method: "POST", body: { action: "REJECT" }, cookie: mCookie }), ctx({ id: String(request.id) }));
    expect(noNote.status).toBe(400);
    const ok = await decideRoute.POST(req(`/api/requests/${request.id}/decide`, { method: "POST", body: { action: "APPROVE" }, cookie: mCookie }), ctx({ id: String(request.id) }));
    expect(ok.status).toBe(200);
    const decided = await prisma.notificationLog.findUnique({ where: { dedupeKey: `req-decided:${request.id}` } });
    expect(decided?.toEmployeeId).toBe(employee.id);
  });

  it("MANAGER phòng khác không duyệt được", async () => {
    const r = await prisma.leaveRequest.create({
      data: { employeeId: otherDeptEmployee.id, type: "NGHI_PHEP", fromTime: new Date(Date.now() + 86_400_000), toTime: new Date(Date.now() + 2 * 86_400_000), reason: "Việc gia đình đột xuất" },
    });
    const mCookie = await sessionCookie(managerKD.id);
    const res = await decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", body: { action: "APPROVE" }, cookie: mCookie }), ctx({ id: String(r.id) }));
    expect(res.status).toBe(403);
  });

  it("trễ có đơn PENDING phủ giờ vào thì không sinh tin nhắc; không có đơn thì có", async () => {
    const day = nextWeekday(todayVN(), 4);
    const a = await byCode("NV002");
    const b = await byCode("NV006");
    await prisma.leaveRequest.create({
      data: { employeeId: a.id, type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00"), toTime: vnDateTime(day, "10:00"), reason: "Đi khám sức khỏe buổi sáng" },
    });
    for (const [emp, expectMsg] of [
      [a, false],
      [b, true],
    ] as const) {
      const out = await recordScan({ employeeId: emp.id, checkTime: vnDateTime(day, "08:20"), source: "MANUAL", createdById: admin.id });
      if (out.status !== "CREATED") throw new Error("không tạo log");
      expect(out.log.isLate).toBe(true);
      await notifyLateIfNeeded({ employeeId: emp.id, log: out.log, plan: out.plan, requests: out.requests });
      const n = await prisma.notificationLog.count({ where: { dedupeKey: `late:${emp.id}:${day}` } });
      expect(n).toBe(expectMsg ? 1 : 0);
    }
  });

  it("duyệt đơn cho ngày đã có log thì tính lại trễ", async () => {
    const day = nextWeekday(todayVN(), 5);
    const out = await recordScan({ employeeId: employee.id, checkTime: vnDateTime(day, "10:05"), source: "MANUAL", createdById: admin.id });
    if (out.status !== "CREATED") throw new Error("không tạo log");
    expect(out.log.isLate).toBe(true);
    const r = await prisma.leaveRequest.create({
      data: { employeeId: employee.id, type: "NGHI_PHEP", fromTime: vnDateTime(day, "08:00"), toTime: vnDateTime(day, "10:00"), reason: "Nghỉ buổi sáng đi làm giấy tờ" },
    });
    const mCookie = await sessionCookie(managerKD.id);
    const res = await decideRoute.POST(req(`/api/requests/${r.id}/decide`, { method: "POST", body: { action: "APPROVE" }, cookie: mCookie }), ctx({ id: String(r.id) }));
    expect((await res.json()).recomputedDays).toBeGreaterThan(0);
    const log = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: out.log.id } });
    expect(log.isLate).toBe(false);
    expect(log.excusedByRequestId).toBe(r.id);
  });
});

describe("kiosk — lớp L2 phía server (LIVENESS_SERVER=true)", () => {
  const sampleJpeg = () =>
    "data:image/jpeg;base64," + readFileSync(join(process.cwd(), "node_modules", "@vladmandic", "human", "assets", "samples.jpg")).toString("base64");
  const scan = async (cookie: string, extra: Record<string, unknown>, base: number[]) =>
    (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body: { ...scanPayload(base), frames: frames(0.95), clientEventId: randomUUID(), capturedAt: new Date().toISOString(), ...extra } }), ctx())).json();

  it("thiếu khung mặt => từ chối (client không né được L2)", async () => {
    process.env.LIVENESS_SERVER = "true";
    try {
      const base = await enrollFake((await byCode("NV011")).id, 11);
      const { cookie } = await pairedDevice("Kiosk L2 thiếu dữ liệu");
      expect((await scan(cookie, {}, base)).result).toBe("REJECTED_SPOOF");
      expect((await scan(cookie, { snapshot: sampleJpeg() }, base)).result).toBe("REJECTED_SPOOF");
      const a = await prisma.auditLog.findFirst({ where: { action: "SCAN_SPOOF_REJECTED" }, orderBy: { id: "desc" } });
      expect(JSON.parse(a!.detail!).server.status).toBe("missing_input");
    } finally {
      delete process.env.LIVENESS_SERVER;
    }
  });

  it("L1 đạt nhưng L2 chấm giả => từ chối; L2 chấm thật => nhận", async () => {
    process.env.LIVENESS_SERVER = "true";
    try {
      const base = await enrollFake((await byCode("NV012")).id, 12);
      const { cookie } = await pairedDevice("Kiosk L2 mock");
      registerServerLiveness(async () => ({ score: 0.05 }));
      const bad = await scan(cookie, { snapshot: sampleJpeg(), faceBox: [512, 347, 200, 200] }, base);
      expect(bad.result).toBe("REJECTED_SPOOF");
      registerServerLiveness(async () => ({ score: 0.97 }));
      const ok = await scan(cookie, { snapshot: sampleJpeg(), faceBox: [512, 347, 200, 200] }, base);
      expect(ok.result).toBe("OK");
      expect(ok.employee.code).toBe("NV012");
      const log = await prisma.attendanceLog.findFirstOrThrow({ where: { employee: { code: "NV012" }, source: "KIOSK" }, orderBy: { id: "desc" } });
      expect(log.verified3D).toBe(true);
      expect(log.livenessScore).toBeCloseTo(0.95, 2); // điểm yếu nhất giữa L1 (0.95) và L2 (0.97)
    } finally {
      registerServerLiveness(null);
      delete process.env.LIVENESS_SERVER;
    }
  });

  it.skipIf(!existsSync(modelPath()))("chạy thật MiniFASNetV2 trên snapshot, ghi điểm L2 vào AuditLog khi từ chối", async () => {
    process.env.LIVENESS_SERVER = "true";
    try {
      const base = await enrollFake((await byCode("NV013")).id, 13);
      const { cookie } = await pairedDevice("Kiosk L2 thật");
      // Góc ảnh không có mặt người: MiniFASNetV2 cho xác suất "thật" ≈ 0 => bị từ chối dù L1 đạt.
      const r = await scan(cookie, { snapshot: sampleJpeg(), faceBox: [0, 0, 90, 90] }, base);
      expect(r.result).toBe("REJECTED_SPOOF");
      const a = await prisma.auditLog.findFirst({ where: { action: "SCAN_SPOOF_REJECTED" }, orderBy: { id: "desc" } });
      const server = JSON.parse(a!.detail!).server;
      expect(server.status).toBe("checked");
      expect(server.score).toBeLessThan(0.1);
      expect(server.probs).toHaveLength(3);
    } finally {
      delete process.env.LIVENESS_SERVER;
    }
  });

  it("L2 bật nhưng thiếu mô hình => tạm dùng L1 và ghi cảnh báo cho ADMIN", async () => {
    process.env.LIVENESS_SERVER = "true";
    registerServerLiveness(async () => {
      throw new Error("Không tìm thấy mô hình L2");
    });
    try {
      const base = await enrollFake((await byCode("NV014")).id, 14);
      const { cookie } = await pairedDevice("Kiosk L2 lỗi");
      const r = await scan(cookie, { snapshot: sampleJpeg(), faceBox: [512, 347, 200, 200] }, base);
      expect(r.result).toBe("OK");
      expect(await prisma.auditLog.count({ where: { action: "LIVENESS_L2_UNAVAILABLE" } })).toBeGreaterThan(0);
    } finally {
      registerServerLiveness(null);
      delete process.env.LIVENESS_SERVER;
    }
  });
});

describe("xếp ca sau khi đã quét", () => {
  it("quét ngày nghỉ (ngoài ca) rồi mới xếp ca => log được gán vào ca, không bị tính vắng", async () => {
    let sunday = addDays(todayVN(), -15); // tránh tuần mà roster.test đăng ký (dùng chung DB)
    while (weekday(sunday) !== 7) sunday = addDays(sunday, -1);
    const e = await byCode("NV009");
    const out = await recordScan({ employeeId: e.id, checkTime: vnDateTime(sunday, "07:58"), source: "MANUAL", createdById: admin.id });
    if (out.status !== "CREATED") throw new Error("không tạo log");
    expect(out.log.shiftId).toBeNull();
    const hc = await prisma.shift.findUniqueOrThrow({ where: { name: "Hành chính" } });
    const cookie = await sessionCookie(admin.id);
    const res = await rosterRoute.PUT(req("/api/roster", { method: "PUT", cookie, body: { cells: [{ employeeId: e.id, date: sunday, shiftId: hc.id, isDayOff: false }] } }), ctx());
    expect(res.status).toBe(200);
    // Tuần chưa đăng ký => lịch chỉ là bản nháp, chưa ảnh hưởng chấm công.
    expect((await prisma.attendanceLog.findUniqueOrThrow({ where: { id: out.log.id } })).shiftId).toBeNull();
    // Đăng ký tuần (muộn, bởi Quản trị) => lịch có hiệu lực, log được gán lại vào ca.
    const reg = await registerRoute.POST(req("/api/roster/register", { method: "POST", cookie, body: { week: sunday, departmentIds: [e.departmentId] } }), ctx());
    expect(reg.status).toBe(200);
    const log = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: out.log.id } });
    expect(log.shiftId).toBe(hc.id);
    expect(log.type).toBe("IN");
    expect(log.isLate).toBe(false);
  });
});

describe("Zalo token", () => {
  it("refresh lưu lại cặp token mới; hai lời gọi đồng thời chỉ refresh một lần", async () => {
    const env = {
      ZALO_OA_APP_ID: "app",
      ZALO_OA_SECRET: "secret",
      ZALO_OA_ACCESS_TOKEN: "at-0",
      ZALO_OA_REFRESH_TOKEN: "rt-0",
      ZALO_WEBHOOK_SECRET: "wh",
    };
    Object.assign(process.env, env);
    try {
      await prisma.zaloToken.deleteMany();
      await prisma.zaloToken.create({ data: { id: 1, accessToken: "at-0", refreshToken: "rt-0", expiresAt: new Date(Date.now() + 10 * 60_000) } });
      let calls = 0;
      __setZaloTestHooks({
        sleep: async () => {},
        fetch: async (_url, init) => {
          calls++;
          const used = new URLSearchParams(String(init.body)).get("refresh_token");
          await new Promise((r) => setTimeout(r, 50));
          return { ok: true, status: 200, json: async () => ({ access_token: `at-${calls}`, refresh_token: `rt-${calls}`, expires_in: "90000", used }) };
        },
      });
      const [a, b] = await Promise.all([refreshZaloToken(), refreshZaloToken()]);
      expect(calls).toBe(1);
      expect(a).toBe("at-1");
      expect(b).toBe("at-1");
      const t = await prisma.zaloToken.findUniqueOrThrow({ where: { id: 1 } });
      expect(t.refreshToken).toBe("rt-1");
      expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * 3600_000);
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  });
});

describe("xuất Excel", () => {
  it("có đủ 2 sheet và tổng phút trễ khớp dữ liệu seed", async () => {
    const to = addDays(todayVN(), -1);
    const from = addDays(to, -7);
    const cookie = await sessionCookie(admin.id);
    const res = await xlsxRoute.GET(req(`/api/reports/attendance.xlsx?from=${from}&to=${to}`, { cookie }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`BangCong_${from.replaceAll("-", "")}_${to.replaceAll("-", "")}.xlsx`);
    const wb = await readXlsx(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Tổng hợp", "Chi tiết"]);
    const rows = wb.rows<Record<string, number>>("Tổng hợp");
    const total = rows.reduce((s, r) => s + (r["Tổng phút trễ"] ?? 0), 0);
    const agg = await prisma.attendanceLog.aggregate({
      where: { type: "IN", isLate: true, workDate: { gte: from, lte: to }, shiftId: { not: null }, employee: { active: true } },
      _sum: { lateMinutes: true },
    });
    expect(total).toBe(agg._sum.lateMinutes ?? 0);
    expect(total).toBeGreaterThan(0);
  });
});
