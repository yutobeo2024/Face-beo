// v1.20.0: tin Zalo tổng hợp đồng phục cuối ngày — gom theo (phòng | ngày | ca), không gửi khi cả nhóm đạt.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { renderMessage } from "@/lib/zalo-templates";
import { DIGEST_MAX_ROWS, runUniformDigest } from "@/lib/uniform-service";
import { byCode } from "./helpers";

type E = Awaited<ReturnType<typeof byCode>>;
let mgr: E, emp: E, hr: E;
const today = todayVN();
const seeded: number[] = [];
let savedManagerId: number | null = null;

async function seed(o: { employeeId: number; departmentId: number; status: string; mode?: string; shiftId?: number | null; workDate?: string }) {
  const row = await prisma.uniformCheck.create({
    data: {
      employeeId: o.employeeId,
      departmentId: o.departmentId,
      workDate: o.workDate ?? today,
      shiftId: o.shiftId === undefined ? 1 : o.shiftId,
      checkTime: new Date(),
      mode: o.mode ?? "ON",
      machineStatus: o.status,
      status: o.status,
      reason: o.status === "FAIL" ? "LOW_SCORE" : o.status === "REVIEW" ? "AMBIGUOUS" : null,
    },
  });
  seeded.push(row.id);
  return row;
}

const digestLogs = (deptId: number) =>
  prisma.notificationLog.findMany({ where: { messageType: "UNIFORM_DIGEST", dedupeKey: { startsWith: `uniform-digest:${deptId}:${today}:` } } });

beforeAll(async () => {
  [hr, mgr, emp] = await Promise.all([byCode("NV016"), byCode("NV003"), byCode("NV008")]);
  savedManagerId = (await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId }, select: { managerId: true } })).managerId;
  await prisma.department.update({ where: { id: emp.departmentId }, data: { managerId: mgr.id } });
});

afterEach(async () => {
  await prisma.uniformCheck.deleteMany({ where: { id: { in: seeded.splice(0) } } });
  await prisma.notificationLog.deleteMany({ where: { messageType: "UNIFORM_DIGEST" } });
  await prisma.department.update({ where: { id: emp.departmentId }, data: { managerId: mgr.id } });
});

// Trả trưởng phòng về đúng người như trước khi chạy test.
afterAll(async () => {
  await prisma.department.update({ where: { id: emp.departmentId }, data: { managerId: savedManagerId } });
});

describe("tin tổng hợp đồng phục", () => {
  it("gửi cho quản lý phòng, một tin cho mỗi (phòng | ngày | ca)", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL" });
    await seed({ employeeId: hr.id, departmentId: emp.departmentId, status: "PASS" });
    const r = await runUniformDigest();
    expect(r.sent).toBe(1);
    const logs = await digestLogs(emp.departmentId);
    expect(logs).toHaveLength(1);
    expect(logs[0].toEmployeeId).toBe(mgr.id);
    expect(logs[0].dedupeKey).toBe(`uniform-digest:${emp.departmentId}:${today}:1`);
  });

  it("cả nhóm đều đạt → KHÔNG gửi tin", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "PASS" });
    await seed({ employeeId: hr.id, departmentId: emp.departmentId, status: "PASS" });
    const r = await runUniformDigest();
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(await digestLogs(emp.departmentId)).toHaveLength(0);
  });

  it("bản ghi chạy thử không gửi tin cho ai", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL", mode: "SHADOW" });
    expect((await runUniformDigest()).sent).toBe(0);
    expect(await digestLogs(emp.departmentId)).toHaveLength(0);
    // Bản chạy thử không bị đánh dấu đã gom: hôm nào bật thật vẫn tính lại được.
    const row = await prisma.uniformCheck.findFirstOrThrow({ where: { id: { in: seeded } } });
    expect(row.digestAt).toBeNull();
  });

  it("chạy lại lần hai không gửi trùng", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "REVIEW" });
    expect((await runUniformDigest()).sent).toBe(1);
    expect((await runUniformDigest()).groups).toBe(0); // đã đánh dấu digestAt
    expect(await digestLogs(emp.departmentId)).toHaveLength(1);
  });

  it("đánh dấu digestAt cho cả bản đạt để hôm sau không gom lại", async () => {
    const pass = await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "PASS" });
    await runUniformDigest();
    expect((await prisma.uniformCheck.findUniqueOrThrow({ where: { id: pass.id } })).digestAt).not.toBeNull();
  });

  it("ca khác nhau thì tách thành hai tin", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL", shiftId: 1 });
    await seed({ employeeId: hr.id, departmentId: emp.departmentId, status: "FAIL", shiftId: 2 });
    expect((await runUniformDigest()).sent).toBe(2);
    expect((await digestLogs(emp.departmentId)).map((l) => l.dedupeKey).sort()).toEqual([
      `uniform-digest:${emp.departmentId}:${today}:1`,
      `uniform-digest:${emp.departmentId}:${today}:2`,
    ]);
  });

  it("phòng chưa có trưởng phòng → gửi cho Nhân sự/Quản trị", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { managerId: null } });
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL" });
    await runUniformDigest();
    const logs = await digestLogs(emp.departmentId);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.toEmployeeId !== mgr.id)).toBe(true);
  });

  it("chỉ gom ngày hôm nay", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL", workDate: "2020-01-02" });
    expect((await runUniformDigest()).groups).toBe(0);
  });
});

describe("nội dung tin", () => {
  const data = (n: number) => ({
    departmentName: "Phòng Khám",
    dateText: "30/09/2026",
    shiftName: "Ca sáng",
    total: 20,
    items: Array.from({ length: Math.min(n, DIGEST_MAX_ROWS) }, (_, i) => ({ name: `Người ${i + 1}`, code: `NV${i + 1}`, note: "không đúng đồng phục" })),
    more: Math.max(0, n - DIGEST_MAX_ROWS),
  });

  it("nêu phòng, ca, ngày và số người cần lưu ý; không kèm lý do cá nhân", () => {
    const text = renderMessage("UNIFORM_DIGEST", data(2));
    expect(text).toContain("Phòng Khám");
    expect(text).toContain("ca Ca sáng");
    expect(text).toContain("30/09/2026");
    expect(text).toContain("Đã kiểm 20 người, cần lưu ý 2 người");
    expect(text).toContain("1. Người 1 (NV1) — không đúng đồng phục");
    expect(text).not.toMatch(/Áo không giống mẫu|Máy chưa chắc/); // không lộ lý do máy
    expect(text).toContain("/admin/uniform");
  });

  it("quá 15 người thì cắt bớt và ghi rõ còn bao nhiêu", () => {
    const text = renderMessage("UNIFORM_DIGEST", data(18));
    expect(text.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(DIGEST_MAX_ROWS);
    expect(text).toContain("… và 3 người nữa");
  });

  it("nhắc rõ 'cần xem lại' là máy chưa chắc", () => {
    expect(renderMessage("UNIFORM_DIGEST", data(1))).toContain("Nhân sự xem ảnh rồi mới kết luận");
  });
});
