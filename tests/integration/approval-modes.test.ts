// v1.7.0: cách duyệt đơn cấu hình theo phòng — MANAGER_OR_HR (mặc định) / TWO_STEP / MANAGER_ONLY.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { approversFor } from "@/lib/notify";
import { requestOverdue } from "@/lib/jobs";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as requestsRoute from "@/app/api/requests/route";
import * as decideRoute from "@/app/api/requests/[id]/decide/route";
import * as cancelRoute from "@/app/api/requests/[id]/cancel/route";
import * as deptRoute from "@/app/api/departments/[id]/route";
import * as overviewRoute from "@/app/api/me/overview/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, emp: E;
let A: string, H: string, M: string, EMP: string;
const created: number[] = [];
let slot = 40; // mỗi đơn một ngày riêng trong tương lai (tránh trùng đơn)

const setMode = (mode: string) => prisma.department.update({ where: { id: emp.departmentId }, data: { approvalMode: mode } });

async function newRequest() {
  const day = addDays(todayVN(), slot++);
  const body = { type: "VE_SOM", fromTime: vnDateTime(day, "16:00").toISOString(), toTime: vnDateTime(day, "17:00").toISOString(), reason: "Việc gia đình cần về sớm" };
  const res = await requestsRoute.POST(req("/api/requests", { method: "POST", body, cookie: EMP }), ctx());
  expect(res.status).toBe(201);
  const { request } = await res.json();
  created.push(request.id);
  return request.id as number;
}
const decide = (cookie: string, id: number, action = "APPROVE", note?: string) =>
  decideRoute.POST(req(`/api/requests/${id}/decide`, { method: "POST", cookie, body: { action, note } }), ctx({ id: String(id) }));
const status = async (id: number) => (await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status;
const listCanDecide = async (cookie: string, id: number) =>
  (await (await requestsRoute.GET(req("/api/requests?scope=team&status=PENDING", { cookie }), ctx())).json()).requests.find((x: { id: number }) => x.id === id)?.canDecide;

beforeAll(async () => {
  [admin, hr, mgr, emp] = await Promise.all(["NV001", "NV016", "NV003", "NV008"].map(byCode)); // NV008 thuộc Kinh doanh, quản lý NV003
  [A, H, M, EMP] = await Promise.all([admin, hr, mgr, emp].map((e) => sessionCookie(e.id)));
});

afterAll(async () => {
  await setMode("MANAGER_OR_HR");
  await prisma.leaveRequest.deleteMany({ where: { id: { in: created } } });
});

describe("MANAGER_OR_HR (mặc định)", () => {
  it("trưởng phòng và HR đều nhận tin đơn mới; HR duyệt được ngay, người thứ hai → 400", async () => {
    await setMode("MANAGER_OR_HR");
    expect(await approversFor(emp.id)).toEqual(expect.arrayContaining([mgr.id, hr.id]));
    const id = await newRequest();
    for (const to of [mgr.id, hr.id]) expect(await prisma.notificationLog.count({ where: { dedupeKey: `req-created:${id}:${to}` } })).toBe(1);
    expect(await listCanDecide(H, id)).toBe(true);
    expect(await listCanDecide(M, id)).toBe(true);
    expect((await decide(H, id)).status).toBe(200);
    expect(await status(id)).toBe("APPROVED");
    expect((await decide(M, id)).status).toBe(400);
  });

  it("trưởng phòng duyệt cũng có hiệu lực ngay", async () => {
    const id = await newRequest();
    expect((await decide(M, id)).status).toBe(200);
    expect(await status(id)).toBe("APPROVED");
  });
});

describe("TWO_STEP", () => {
  it("HR không duyệt được bước 1; trưởng duyệt → MANAGER_APPROVED, báo HR; HR duyệt bước 2 → APPROVED", async () => {
    await setMode("TWO_STEP");
    const id = await newRequest();
    expect(await approversFor(emp.id)).toEqual([mgr.id]);
    expect((await decide(H, id)).status).toBe(403);
    expect(await listCanDecide(H, id)).toBe(false);

    const step1 = await decide(M, id, "APPROVE", "Đồng ý về phía chuyên môn");
    expect(step1.status).toBe(200);
    const r1 = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(r1).toMatchObject({ status: "MANAGER_APPROVED", managerApproverId: mgr.id, managerNote: "Đồng ý về phía chuyên môn", approverId: null });
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `req-stage2:${id}:${hr.id}` } })).toBe(1);
    // Đơn vẫn tính là "đang chờ" ở trang cá nhân; trưởng phòng không duyệt lần hai.
    const ov = await (await overviewRoute.GET(req("/api/me/overview", { cookie: EMP }), ctx())).json();
    expect(ov.pendingRequests).toBeGreaterThanOrEqual(1);
    expect((await decide(M, id)).status).toBe(403);
    expect(await listCanDecide(H, id)).toBe(true);

    expect((await decide(H, id)).status).toBe(200);
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED", approverId: hr.id, managerApproverId: mgr.id });
  });

  it("HR từ chối ở bước 2 → REJECTED; Quản trị duyệt thẳng ở bước 1 là quyết định cuối", async () => {
    const a = await newRequest();
    expect((await decide(M, a)).status).toBe(200);
    expect((await decide(H, a, "REJECT", "Thiếu người trực hôm đó")).status).toBe(200);
    expect(await status(a)).toBe("REJECTED");
    const b = await newRequest();
    expect((await decide(A, b)).status).toBe(200);
    expect(await status(b)).toBe("APPROVED");
  });

  it("đơn đang chờ HR vẫn do HR quyết định khi phòng đổi cách duyệt giữa chừng; trưởng phòng không duyệt lại", async () => {
    const id = await newRequest();
    expect((await decide(M, id)).status).toBe(200);
    expect(await status(id)).toBe("MANAGER_APPROVED");
    await setMode("MANAGER_ONLY");
    try {
      expect(await approversFor(emp.id, "MANAGER_APPROVED")).not.toContain(mgr.id);
      expect((await decide(M, id)).status).toBe(403);
      expect((await decide(H, id)).status).toBe(200);
      expect(await status(id)).toBe("APPROVED");
    } finally {
      await setMode("TWO_STEP");
    }
  });

  it("danh sách đánh dấu nút của trưởng phòng là bước 1", async () => {
    const id = await newRequest();
    const row = (await (await requestsRoute.GET(req("/api/requests?scope=team&status=PENDING", { cookie: M }), ctx())).json()).requests.find((x: { id: number }) => x.id === id);
    expect(row).toMatchObject({ canDecide: true, step1: true });
  });

  it("nhân viên hủy được đơn đang chờ HR (MANAGER_APPROVED)", async () => {
    const id = await newRequest();
    expect((await decide(M, id)).status).toBe(200);
    const res = await cancelRoute.POST(req(`/api/requests/${id}/cancel`, { method: "POST", cookie: EMP }), ctx({ id: String(id) }));
    expect(res.status).toBe(200);
    expect(await status(id)).toBe("CANCELLED");
  });

  it("job quá hạn: đơn chờ bước 2 quá 24 giờ (tính từ lúc trưởng duyệt) nhắc Nhân sự", async () => {
    const id = await newRequest();
    expect((await decide(M, id)).status).toBe(200);
    await prisma.leaveRequest.update({ where: { id }, data: { managerDecidedAt: new Date(Date.now() - 25 * 3600_000) } });
    await requestOverdue(new Date());
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `req2-overdue24:${id}:${hr.id}` } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { dedupeKey: `req2-overdue24:${id}:${mgr.id}` } })).toBe(0);
  });
});

describe("MANAGER_ONLY", () => {
  it("chỉ trưởng phòng duyệt, HR → 403", async () => {
    await setMode("MANAGER_ONLY");
    const id = await newRequest();
    expect((await decide(H, id)).status).toBe(403);
    expect((await decide(M, id)).status).toBe(200);
    expect(await status(id)).toBe("APPROVED");
  });
});

describe("cấu hình cách duyệt theo phòng", () => {
  it("PATCH approvalMode: sai giá trị → 400, Quản lý → 403, Quản trị → 200 và báo nhóm minh bạch", async () => {
    const patch = (cookie: string, body: unknown) => deptRoute.PATCH(req(`/api/departments/${emp.departmentId}`, { method: "PATCH", cookie, body }), ctx({ id: String(emp.departmentId) }));
    expect((await patch(A, { approvalMode: "BAT_KY" })).status).toBe(400);
    expect((await patch(M, { approvalMode: "TWO_STEP" })).status).toBe(403);
    expect((await patch(A, { approvalMode: "TWO_STEP" })).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId } })).approvalMode).toBe("TWO_STEP");
    // Gửi trường khác (đổi tên) không làm mất cách duyệt đã chọn (PATCH không có .default()).
    const d = await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId } });
    expect((await patch(A, { name: d.name })).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId } })).approvalMode).toBe("TWO_STEP");
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `grp:dept-approval:${emp.departmentId}:` } } })).toBeGreaterThan(0);
  });
});
