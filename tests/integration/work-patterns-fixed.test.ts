// v1.12.1: nhân viên ca cố định luôn theo một mẫu tuần trong Cấu hình — không còn "ca mặc định, nghỉ Chủ nhật" ẩn.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN } from "@/lib/attendance";
import { buildPlanner } from "@/lib/attendance-service";
import { backfillFixedPatterns, ensurePatternFor } from "@/lib/work-patterns";
import { createEmployee } from "@/lib/employees";
import { byCode, ctx, req, sessionCookie } from "./helpers";
import * as employeeRoute from "@/app/api/employees/[id]/route";

const tag = `W${Date.now().toString().slice(-5)}`;
let A: string;
let shiftId = 0;
let deptId = 0;
const ids: number[] = [];
const createdPatterns: number[] = [];

beforeAll(async () => {
  A = await sessionCookie((await byCode("NV001")).id);
  // Ca riêng cho test để mẫu "<ca> T2–T7" chắc chắn chưa có sẵn.
  shiftId = (await prisma.shift.create({ data: { name: `Ca test ${tag}`, startTime: "06:00", endTime: "14:00", breakMinutes: 0, graceLateMinutes: 5, graceEarlyMinutes: 0 } })).id;
  deptId = (await prisma.department.create({ data: { name: `Phòng ${tag}` } })).id;
});
afterAll(async () => {
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity: "Employee", entityId: { in: ids.map(String) } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.workPattern.deleteMany({ where: { OR: [{ id: { in: createdPatterns } }, { monShiftId: shiftId }] } });
  await prisma.department.deleteMany({ where: { id: deptId } });
  await prisma.shift.deleteMany({ where: { id: shiftId } });
});

const mk = async (code: string, extra: Record<string, unknown> = {}) => {
  const e = (await createEmployee({ code: `${tag}${code}`, name: `NV ${code}`, role: "EMPLOYEE", departmentId: deptId, defaultShiftId: shiftId, ...extra } as never, null)).employee;
  ids.push(e.id);
  return e;
};

describe("ensurePatternFor", () => {
  it("tạo mẫu '<ca> T2–T7' (T2–T7 = ca, CN nghỉ) một lần, lần sau dùng lại — không tạo trùng", async () => {
    const p1 = await ensurePatternFor(shiftId);
    createdPatterns.push(p1.id);
    expect(p1.name).toBe(`Ca test ${tag} T2–T7`);
    expect([p1.monShiftId, p1.friShiftId, p1.satShiftId, p1.sunShiftId]).toEqual([shiftId, shiftId, shiftId, null]);
    expect((await ensurePatternFor(shiftId)).id).toBe(p1.id);
    await expect(ensurePatternFor(999_999)).rejects.toThrow("Ca mặc định không tồn tại");
  });
});

describe("mọi đường lưu nhân viên cố định đều có mẫu", () => {
  it("tạo nhân viên cố định không gửi mẫu → gán mẫu tương đương; xoay ca không có mẫu", async () => {
    const f = await mk("F");
    const p = await prisma.workPattern.findUniqueOrThrow({ where: { id: f.workPatternId! } });
    expect([p.monShiftId, p.sunShiftId]).toEqual([shiftId, null]);
    const r = await mk("R", { scheduleType: "ROTATING" });
    expect(r.workPatternId).toBeNull();
  });

  it("PATCH nhân viên cố định bỏ trống mẫu (workPatternId: null) → vẫn được gán mẫu; ca không tồn tại → 400", async () => {
    const e = await mk("P");
    const res = await employeeRoute.PATCH(req(`/api/employees/${e.id}`, { method: "PATCH", cookie: A, body: { workPatternId: null } }), ctx({ id: String(e.id) }));
    expect(res.status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).workPatternId).not.toBeNull();
    const bad = await employeeRoute.PATCH(req(`/api/employees/${e.id}`, { method: "PATCH", cookie: A, body: { defaultShiftId: 999_999, workPatternId: null } }), ctx({ id: String(e.id) }));
    expect(bad.status).toBe(400);
  });
});

describe("chuyển dữ liệu cũ (backfillFixedPatterns)", () => {
  it("nhân viên cố định không mẫu → có mẫu; lịch 14 ngày trước / sau giống hệt; chạy lại không đổi gì", async () => {
    const e = await mk("B");
    await prisma.employee.update({ where: { id: e.id }, data: { workPatternId: null } }); // giả lập dữ liệu cũ "không mẫu"
    await prisma.scheduleAssignment.deleteMany({ where: { employeeId: e.id } });
    const from = startOfWeek(todayVN());
    const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
    const plan = async () => {
      const pl = await buildPlanner([e.id], days[0], days[13]);
      return days.map((d) => { const p = pl.planFor(e.id, d); return `${d}:${p.shift?.id ?? "-"}:${p.isDayOff}`; });
    };
    const before = await plan();
    const done = await backfillFixedPatterns();
    expect(done.map((x) => x.code)).toContain(`${tag}B`);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).workPatternId).not.toBeNull();
    expect(await plan()).toEqual(before);
    expect((await backfillFixedPatterns()).map((x) => x.code)).not.toContain(`${tag}B`);
  });
});
