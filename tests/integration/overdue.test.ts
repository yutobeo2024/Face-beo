import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { requestOverdue } from "@/lib/jobs";
import { approversFor, executorsFor } from "@/lib/notify";
import { byCode } from "./helpers";

type E = Awaited<ReturnType<typeof byCode>>;
let emp: E, admin: E;
const H = 3_600_000;
// Thời điểm tương lai xa để không đụng các đơn/tin của file test khác.
const d = addDays(todayVN(), 40);

async function mkReq(data: { type: string; status: string; createdAt: Date; decidedAt?: Date; correction?: boolean }) {
  return prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      type: data.type,
      status: data.status,
      fromTime: vnDateTime(d, "08:00"),
      toTime: vnDateTime(d, data.correction ? "08:01" : "12:00"),
      correctionAt: data.correction ? vnDateTime(d, "08:00") : null,
      correctionKind: data.correction ? "IN" : null,
      reason: "Đơn thử quá hạn D3",
      createdAt: data.createdAt,
      decidedAt: data.decidedAt ?? null,
    },
  });
}
const count = (prefix: string) => prisma.notificationLog.count({ where: { dedupeKey: { startsWith: prefix } } });

beforeAll(async () => {
  emp = await byCode("NV014");
  admin = await byCode("NV001");
});

describe("D3 — nhắc đơn quá hạn (không tự duyệt)", () => {
  it("chờ duyệt 23h: chưa nhắc; 25h: nhắc người duyệt, chưa báo Quản trị", async () => {
    const now = new Date();
    const young = await mkReq({ type: "NGHI_PHEP", status: "PENDING", createdAt: new Date(now.getTime() - 23 * H) });
    const r = await mkReq({ type: "NGHI_PHEP", status: "PENDING", createdAt: new Date(now.getTime() - 25 * H) });
    await requestOverdue(now);
    expect(await count(`req-overdue24:${young.id}:`)).toBe(0);
    const approvers = await approversFor(emp.id);
    expect(approvers.length).toBeGreaterThan(0);
    expect(await count(`req-overdue24:${r.id}:`)).toBe(approvers.length);
    expect(await count(`req-overdue48:${r.id}`)).toBe(0);
    expect(await count(`grp:req-overdue48:${r.id}`)).toBe(0);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });

  it("chờ duyệt 49h: báo mọi Quản trị + nhóm Zalo; chạy lại không gửi trùng", async () => {
    const now = new Date();
    const r = await mkReq({ type: "NGHI_PHEP", status: "PENDING", createdAt: new Date(now.getTime() - 49 * H) });
    await requestOverdue(now);
    const admins = await prisma.employee.count({ where: { role: "ADMIN", active: true, id: { not: emp.id } } });
    expect(await count(`req-overdue48:${r.id}:`)).toBe(admins);
    expect(await count(`grp:req-overdue48:${r.id}`)).toBe(1);
    const before = await prisma.notificationLog.count();
    await requestOverdue(new Date(now.getTime() + 30 * 60_000));
    expect(await prisma.notificationLog.count()).toBe(before);
    expect(await count(`req-overdue48:${r.id}:${admin.id}`)).toBe(1);
  });

  it("đơn đã xử lý (duyệt / từ chối / hủy) không bị nhắc", async () => {
    const now = new Date();
    const ids = [];
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"]) ids.push((await mkReq({ type: "NGHI_PHEP", status, createdAt: new Date(now.getTime() - 50 * H) })).id);
    await requestOverdue(now);
    for (const id of ids) expect(await count(`req-overdue24:${id}:`)).toBe(0);
  });

  it("bổ sung công đã duyệt, chờ chấm tay quá 24h (tính từ lúc duyệt): nhắc người chấm tay", async () => {
    const now = new Date();
    const r = await mkReq({ type: "BO_SUNG_CONG", status: "APPROVED", createdAt: new Date(now.getTime() - 60 * H), decidedAt: new Date(now.getTime() - 26 * H), correction: true });
    await requestOverdue(now);
    const execs = (await executorsFor(emp.id)).filter((id) => id !== emp.id);
    expect(await count(`corr-overdue24:${r.id}:`)).toBe(execs.length);
    expect(await count(`corr-overdue48:${r.id}`)).toBe(0);
    // Đã chấm tay => không nhắc nữa
    await prisma.leaveRequest.update({ where: { id: r.id }, data: { executedAt: new Date() } });
    const before = await prisma.notificationLog.count();
    await requestOverdue(new Date(now.getTime() + 24 * H));
    expect(await count(`corr-overdue48:${r.id}`)).toBe(0);
    expect(await prisma.notificationLog.count()).toBeGreaterThanOrEqual(before);
  });
});
