// QC v1.12.1 — ca cố định luôn có mẫu tuần: các ca biên / đối kháng chưa có trong work-patterns-fixed.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN } from "@/lib/attendance";
import { buildPlanner, summarizeRange } from "@/lib/attendance-service";
import { invalidatePayrollLockCache } from "@/lib/payroll-lock-state";
import { backfillFixedPatterns, ensurePatternFor } from "@/lib/work-patterns";
import { createEmployee } from "@/lib/employees";
import { IMPORT_COLUMNS } from "@/lib/employee-import";
import { createFirstAdmin } from "@/lib/bootstrap";
import { BASE, byCode, ctx, req, sessionCookie } from "./helpers";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as importRoute from "@/app/api/employees/import/route";

const tag = `Q${Date.now().toString().slice(-5)}`;
let A: string;
let adminId = 0;
let shiftId = 0;
let shift2Id = 0;
let shift3Id = 0;
let deptId = 0;
const ids: number[] = [];
const LOCK_MONTH = "2026-07";
let lockCreated = false;
const tmpDir = join(tmpdir(), `qc-wp-${tag}`);

const mkShift = (n: string) =>
  prisma.shift.create({ data: { name: `Ca ${n} ${tag}`, startTime: "06:00", endTime: "14:00", breakMinutes: 0, graceLateMinutes: 5, graceEarlyMinutes: 0 } });

beforeAll(async () => {
  const admin = await byCode("NV001");
  adminId = admin.id;
  A = await sessionCookie(admin.id);
  shiftId = (await mkShift("A")).id;
  shift2Id = (await mkShift("B")).id;
  shift3Id = (await mkShift("C")).id;
  deptId = (await prisma.department.create({ data: { name: `Phòng ${tag}` } })).id;
});

afterAll(async () => {
  const all = (await prisma.employee.findMany({ where: { code: { startsWith: tag } }, select: { id: true } })).map((e) => e.id);
  const every = [...new Set([...ids, ...all])];
  await prisma.lockedDay.deleteMany({ where: { employeeId: { in: every } } });
  if (lockCreated) {
    await prisma.lockedDay.deleteMany({ where: { month: LOCK_MONTH } });
    await prisma.payrollLock.deleteMany({ where: { month: LOCK_MONTH } });
    invalidatePayrollLockCache();
  }
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: every } } });
  await prisma.auditLog.deleteMany({ where: { entity: "Employee", entityId: { in: every.map(String) } } });
  await prisma.employee.deleteMany({ where: { id: { in: every } } });
  const sids = [shiftId, shift2Id, shift3Id];
  await prisma.workPattern.deleteMany({
    where: {
      OR: [
        { name: { contains: tag } },
        ...(["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const).map((k) => ({ [k]: { in: sids } })),
      ],
    },
  });
  await prisma.department.deleteMany({ where: { id: deptId } });
  await prisma.shift.deleteMany({ where: { id: { in: sids } } });
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

const mk = async (code: string, extra: Record<string, unknown> = {}) => {
  const e = (await createEmployee({ code: `${tag}${code}`, name: `NV ${code}`, role: "EMPLOYEE", departmentId: deptId, defaultShiftId: shiftId, ...extra } as never, null)).employee;
  ids.push(e.id);
  return e;
};
/** Giả lập nhân viên cố định "dữ liệu cũ": không mẫu, không lịch sử snapshot. */
const legacy = async (code: string, extra: Record<string, unknown> = {}) => {
  const e = await mk(code, extra);
  await prisma.employee.update({ where: { id: e.id }, data: { workPatternId: null } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: e.id } });
  return e;
};
const patch = (id: number, body: unknown) =>
  employeeRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie: A, body }), ctx({ id: String(id) }));
const emp = (id: number) => prisma.employee.findUniqueOrThrow({ where: { id } });
const planOf = async (id: number, days: string[]) => {
  const pl = await buildPlanner([id], days[0], days[days.length - 1]);
  return days.map((d) => {
    const p = pl.planFor(id, d);
    return `${d}:${p.shift?.id ?? "-"}:${p.isDayOff}`;
  });
};
const weeks = () => {
  const from = addDays(startOfWeek(todayVN()), -21);
  return Array.from({ length: 49 }, (_, i) => addDays(from, i)); // 3 tuần trước → 4 tuần sau
};
const isEquivalent = async (patternId: number | null, sid: number) => {
  expect(patternId).not.toBeNull();
  const p = await prisma.workPattern.findUniqueOrThrow({ where: { id: patternId! } });
  expect([p.monShiftId, p.tueShiftId, p.wedShiftId, p.thuShiftId, p.friShiftId, p.satShiftId, p.sunShiftId]).toEqual([sid, sid, sid, sid, sid, sid, null]);
};

describe("PATCH /api/employees/[id]", () => {
  it("ROTATING → FIXED không gửi mẫu → được gán mẫu tương đương", async () => {
    const e = await mk("R1", { scheduleType: "ROTATING" });
    expect(e.workPatternId).toBeNull();
    const res = await patch(e.id, { scheduleType: "FIXED" });
    expect(res.status).toBe(200);
    await isEquivalent((await emp(e.id)).workPatternId, shiftId);
  });

  it("FIXED → ROTATING xóa mẫu (kể cả khi gửi kèm workPatternId)", async () => {
    const e = await mk("F1");
    expect(e.workPatternId).not.toBeNull();
    const res = await patch(e.id, { scheduleType: "ROTATING", workPatternId: e.workPatternId });
    expect(res.status).toBe(200);
    expect((await emp(e.id)).workPatternId).toBeNull();
  });

  it("dữ liệu cũ chỉ đổi SĐT → có mẫu; lịch 3 tuần trước / 4 tuần sau giữ nguyên; có snapshot từ hôm nay", async () => {
    const e = await legacy("L1");
    const days = weeks();
    const before = await planOf(e.id, days);
    const res = await patch(e.id, { phone: `09${Date.now().toString().slice(-8)}` });
    expect(res.status).toBe(200);
    const after = await emp(e.id);
    await isEquivalent(after.workPatternId, shiftId);
    expect(await planOf(e.id, days)).toEqual(before);
    const last = await prisma.scheduleAssignment.findFirst({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "desc" } });
    expect(last?.workPatternId).toBe(after.workPatternId);
  });

  it("gửi workPatternId hợp lệ khác → giữ đúng mẫu đó (không bị thay bằng mẫu tương đương)", async () => {
    const custom = await prisma.workPattern.create({ data: { name: `Mẫu riêng ${tag}`, monShiftId: shift2Id, tueShiftId: shift2Id, sunShiftId: shift2Id } });
    const e = await mk("K1");
    const res = await patch(e.id, { workPatternId: custom.id });
    expect(res.status).toBe(200);
    expect((await emp(e.id)).workPatternId).toBe(custom.id);
  });

  it("PATCH bị 400 (chức danh không tồn tại) không để lại mẫu tuần mồ côi", async () => {
    // Ca chưa có mẫu tương đương nào: tạo NV xoay ca rồi chuyển thẳng trong DB sang cố định (dữ liệu cũ).
    const e = await mk("O1", { scheduleType: "ROTATING", defaultShiftId: shift3Id });
    await prisma.employee.update({ where: { id: e.id }, data: { scheduleType: "FIXED" } });
    expect(await prisma.workPattern.count({ where: { monShiftId: shift3Id } })).toBe(0);
    const res = await patch(e.id, { jobTitleId: 999_999 });
    expect(res.status).toBe(400);
    expect((await emp(e.id)).workPatternId).toBeNull();
    expect(await prisma.workPattern.count({ where: { monShiftId: shift3Id } })).toBe(0);
  });
});

describe("ensurePatternFor — tên trùng / chạy đồng thời", () => {
  it("đã có mẫu tên '<ca> T2–T7' nhưng ca khác → tạo '(2)', không dùng lại mẫu sai", async () => {
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shift2Id } });
    const imposter = await prisma.workPattern.create({ data: { name: `${shift.name} T2–T7`, monShiftId: shift2Id, tueShiftId: shift2Id } });
    const p = await ensurePatternFor(shift2Id);
    expect(p.id).not.toBe(imposter.id);
    expect(p.name).toBe(`${shift.name} T2–T7 (2)`);
    await isEquivalent(p.id, shift2Id);
    expect((await ensurePatternFor(shift2Id)).id).toBe(p.id);
  });

  it("gọi đồng thời cho cùng một ca không lỗi unique và chỉ tạo một mẫu", async () => {
    const s = await mkShift("D");
    try {
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => ensurePatternFor(s.id)));
      const errs = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
      expect(errs).toEqual([]);
      expect(await prisma.workPattern.count({ where: { monShiftId: s.id } })).toBe(1);
    } finally {
      await prisma.workPattern.deleteMany({ where: { monShiftId: s.id } });
      await prisma.shift.delete({ where: { id: s.id } });
    }
  });
});

describe("backfillFixedPatterns", () => {
  it("bỏ qua nhân viên đã nghỉ việc và nhân viên xoay ca", async () => {
    const off = await legacy("I1");
    await prisma.employee.update({ where: { id: off.id }, data: { active: false, leftAt: new Date() } });
    const rot = await mk("I2", { scheduleType: "ROTATING" });
    const done = (await backfillFixedPatterns()).map((x) => x.code);
    expect(done).not.toContain(`${tag}I1`);
    expect(done).not.toContain(`${tag}I2`);
    expect((await emp(off.id)).workPatternId).toBeNull();
    expect((await emp(rot.id)).workPatternId).toBeNull();
  });

  it("tháng đã chốt: bản chốt (LockedDay) và kết quả tính lại tháng đó không đổi", async () => {
    expect(await prisma.payrollLock.findUnique({ where: { month: LOCK_MONTH } })).toBeNull();
    const e = await legacy("C1");
    await prisma.employee.update({ where: { id: e.id }, data: { createdAt: new Date("2026-06-01T00:00:00Z") } }).catch(() => undefined);
    const from = `${LOCK_MONTH}-01`;
    const to = `${LOCK_MONTH}-31`;
    const raw = async () => {
      const { summaries } = await summarizeRange([e.id], from, to, new Date(), { ignoreLocks: true });
      return JSON.stringify([...summaries.entries()].map(([k, s]) => [k, s.status, s.workDayUnits, s.plan?.shift?.id ?? null, s.plan?.isDayOff]));
    };
    const rawBefore = await raw();
    const { summaries } = await summarizeRange([e.id], from, to, new Date(), { ignoreLocks: true });
    await prisma.payrollLock.create({ data: { month: LOCK_MONTH, lockedById: adminId } });
    lockCreated = true;
    await prisma.lockedDay.createMany({
      data: [...summaries.entries()].map(([k, s]) => {
        const { departmentId, ...rest } = s;
        return { employeeId: e.id, workDate: k.split("|")[1], month: LOCK_MONTH, departmentId: departmentId ?? null, data: JSON.stringify(rest) };
      }),
    });
    invalidatePayrollLockCache();
    const lockedBefore = await prisma.lockedDay.findMany({ where: { employeeId: e.id }, orderBy: { workDate: "asc" } });
    const planBefore = await planOf(e.id, [from, `${LOCK_MONTH}-15`, to]);

    const done = await backfillFixedPatterns();
    expect(done.map((x) => x.code)).toContain(`${tag}C1`);

    expect(await prisma.lockedDay.findMany({ where: { employeeId: e.id }, orderBy: { workDate: "asc" } })).toEqual(lockedBefore);
    expect(await raw()).toBe(rawBefore);
    expect(await planOf(e.id, [from, `${LOCK_MONTH}-15`, to])).toEqual(planBefore);
    // Lịch sử: bản gốc (không mẫu) + bản từ hôm nay (có mẫu).
    const hist = await prisma.scheduleAssignment.findMany({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "asc" } });
    expect(hist[0].workPatternId).toBeNull();
    expect(hist[hist.length - 1].effectiveFrom).toBe(todayVN());
  });
});

describe("nhập Excel — đường cập nhật", () => {
  type Row = Partial<Record<(typeof IMPORT_COLUMNS)[number]["key"], string | number | Date>>;
  async function xlsx(rows: Row[]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Nhân viên");
    ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
    for (const r of rows) ws.addRow(IMPORT_COLUMNS.map((c) => r[c.key] ?? null));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const post = (body: Buffer, q: string) =>
    importRoute.POST(
      new NextRequest(new URL(`/api/employees/import?${q}`, BASE), { method: "POST", headers: { cookie: A, "content-type": "application/octet-stream" }, body: new Uint8Array(body) }),
      ctx(),
    );

  it("nhân viên cố định cũ (không mẫu) chỉ đổi SĐT qua Excel → có mẫu tương đương; lịch không đổi", async () => {
    const e = await legacy("X1");
    const days = weeks();
    const before = await planOf(e.id, days);
    const res = await post(await xlsx([{ code: e.code, name: e.name, phone: `09${(Date.now() + 7).toString().slice(-8)}` }]), `mode=commit&defaultShiftId=${shiftId}&defaultPatternId=none`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: 1 });
    await isEquivalent((await emp(e.id)).workPatternId, shiftId);
    expect(await planOf(e.id, days)).toEqual(before);
  });

  it("cập nhật Excel gán mẫu ngầm → lịch sử lịch (ScheduleAssignment) ghi nhận mẫu từ hôm nay như PATCH", async () => {
    const e = await legacy("X2");
    const res = await post(await xlsx([{ code: e.code, name: e.name, phone: `09${(Date.now() + 13).toString().slice(-8)}` }]), `mode=commit&defaultShiftId=${shiftId}&defaultPatternId=none`);
    expect(res.status).toBe(200);
    const after = await emp(e.id);
    const last = await prisma.scheduleAssignment.findFirst({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "desc" } });
    expect(last?.workPatternId ?? null).toBe(after.workPatternId);
  });

  it("Excel ROTATING → FIXED (không cột Mẫu tuần) → có mẫu", async () => {
    const e = await mk("X3", { scheduleType: "ROTATING" });
    const res = await post(await xlsx([{ code: e.code, name: e.name, scheduleType: "Cố định" }]), `mode=commit&defaultShiftId=${shiftId}&defaultPatternId=none`);
    expect(res.status).toBe(200);
    await isEquivalent((await emp(e.id)).workPatternId, shiftId);
  });
});

describe("admin:create (createFirstAdmin) trên bản sao DB", () => {
  it("Quản trị đầu tiên là ca cố định và có mẫu tuần tương đương", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const file = join(tmpDir, "copy.db").replace(/\\/g, "/");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file}'`);
    const db = new PrismaClient({ datasourceUrl: `file:${file}` });
    try {
      await db.employee.updateMany({ where: { role: "ADMIN" }, data: { active: false } });
      const r = await createFirstAdmin(db as never, { code: `${tag}AD`, name: "Quản trị QC", phone: "0911222333" });
      const e = await db.employee.findUniqueOrThrow({ where: { code: `${tag}AD`.toUpperCase() }, include: { workPattern: true } });
      expect(r).toBeTruthy();
      expect(e.scheduleType).toBe("FIXED");
      expect(e.workPattern).not.toBeNull();
      const p = e.workPattern!;
      expect([p.monShiftId, p.satShiftId, p.sunShiftId]).toEqual([e.defaultShiftId, e.defaultShiftId, null]);
      const snap = await db.scheduleAssignment.findFirst({ where: { employeeId: e.id } });
      expect(snap?.workPatternId).toBe(e.workPatternId);
    } finally {
      await db.$disconnect();
    }
  });
});
