// v1.20.0: file Excel đồng phục — ba sheet, phạm vi phòng, và BẤT BIẾN "không đụng bảng công".
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { addDays, todayVN } from "@/lib/attendance";
import { invalidatePermissionCache } from "@/lib/permissions";
import { byCode, ctx, req, sessionCookie } from "./helpers";
import { buildUniformReport, uniformToXlsx } from "@/lib/uniform-report";
import { employeeScopeWhere } from "@/lib/auth";

import * as uniformXlsx from "@/app/api/reports/uniform.xlsx/route";
import * as attendanceXlsx from "@/app/api/reports/attendance.xlsx/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, emp: E;
let H = "", M = "", EMP = "";
const today = todayVN();
const yesterday = addDays(today, -1);

async function load(buf: ArrayBuffer | Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}
const headerOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);
const colOf = (ws: ExcelJS.Worksheet, name: string) => headerOf(ws).indexOf(name) + 1;
const cell = (ws: ExcelJS.Worksheet, row: number, name: string) => ws.getRow(row).getCell(colOf(ws, name)).value;
const notesOf = (wb: ExcelJS.Workbook) => {
  const ws = wb.getWorksheet("Ghi chú")!;
  const out: string[] = [];
  ws.eachRow((r, i) => i > 1 && out.push(String(r.getCell(1).value)));
  return out.join("\n");
};

async function seed(o: {
  employeeId: number;
  departmentId: number;
  workDate?: string;
  status?: string;
  machineStatus?: string;
  mode?: string;
  decidedById?: number;
  templateId?: number;
  shiftId?: number;
}) {
  const status = o.status ?? "PASS";
  return prisma.uniformCheck.create({
    data: {
      employeeId: o.employeeId,
      departmentId: o.departmentId,
      workDate: o.workDate ?? today,
      shiftId: o.shiftId ?? null,
      checkTime: new Date(`${o.workDate ?? today}T01:05:00.000Z`), // 08:05 giờ VN
      mode: o.mode ?? "ON",
      machineStatus: o.machineStatus ?? status,
      status,
      reason: status === "REVIEW" ? "AMBIGUOUS" : status === "FAIL" ? "LOW_SCORE" : null,
      templateId: o.templateId ?? null,
      score: 0.72,
      colorScore: 0.81,
      embedScore: 0.64,
      decidedById: o.decidedById ?? null,
      decidedAt: o.decidedById ? new Date() : null,
      note: o.decidedById ? "Mặc áo khoác đồng phục" : null,
    },
  });
}

const download = (cookie: string, extra = "") => uniformXlsx.GET(req(`/api/reports/uniform.xlsx?from=${yesterday}&to=${today}${extra}`, { cookie }), ctx());

beforeAll(async () => {
  [admin, hr, mgr, emp] = await Promise.all([byCode("NV001"), byCode("NV016"), byCode("NV003"), byCode("NV008")]);
  [H, M, EMP] = await Promise.all([hr.id, mgr.id, emp.id].map(sessionCookie));
});

afterEach(async () => {
  await prisma.uniformCheck.deleteMany({ where: { employeeId: { in: [emp.id, mgr.id, hr.id, admin.id] } } });
  await prisma.department.updateMany({ data: { uniformMode: "OFF" } });
  invalidatePermissionCache();
});

afterAll(async () => {
  await prisma.department.updateMany({ data: { uniformMode: "OFF" } });
});

describe("dựng báo cáo đồng phục", () => {
  it("gom đúng số ngày kiểm, tỉ lệ đạt và số ngày do người xác nhận", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: yesterday, status: "PASS" });
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: today, status: "FAIL", machineStatus: "REVIEW", decidedById: hr.id });
    const r = await buildUniformReport({ id: emp.id }, yesterday, today);
    const row = r.summary[0];
    expect(row.checked).toBe(2);
    expect(row.pass).toBe(1);
    expect(row.fail).toBe(1);
    expect(row.review).toBe(0);
    expect(row.decided).toBe(1);
    expect(r.detail).toHaveLength(2);
    // Kết luận của máy giữ nguyên dù người đã sửa.
    expect(r.detail[1].status).toBe("Không đạt");
    expect(r.detail[1].machineStatus).toBe("Cần xem lại");
  });

  it("BỎ QUA không tính vào số ngày kiểm nên không kéo tỉ lệ đạt xuống", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: yesterday, status: "PASS" });
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: today, status: "SKIPPED", machineStatus: "SKIPPED" });
    const r = await buildUniformReport({ id: emp.id }, yesterday, today);
    expect(r.summary[0]).toMatchObject({ checked: 1, pass: 1, skipped: 1 });
    const wb = await load(await uniformToXlsx(r));
    expect(cell(wb.getWorksheet("Tổng hợp")!, 2, "Tỉ lệ đạt (%)")).toBe(100);
  });

  it("lọc theo chế độ: chỉ lấy bản kiểm thật", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: yesterday, mode: "SHADOW" });
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: today, mode: "ON" });
    expect((await buildUniformReport({ id: emp.id }, yesterday, today)).detail).toHaveLength(2);
    const onlyReal = await buildUniformReport({ id: emp.id }, yesterday, today, "ON");
    expect(onlyReal.detail).toHaveLength(1);
    expect(onlyReal.detail[0].mode).toBe("Kiểm thật");
  });

  it("ngoài khoảng ngày thì không lấy", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, workDate: addDays(today, -5) });
    expect((await buildUniformReport({ id: emp.id }, yesterday, today)).detail).toHaveLength(0);
  });
});

describe("file Excel", () => {
  it("ba sheet, đủ tiêu đề, đóng băng dòng tiêu đề và có bộ lọc", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "REVIEW" });
    const wb = await load(await uniformToXlsx(await buildUniformReport({ id: emp.id }, yesterday, today)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Chi tiết", "Ghi chú"]);
    expect(headerOf(wb.getWorksheet("Tổng hợp")!)).toEqual([
      "Mã NV", "Họ tên", "Phòng ban", "Số ngày kiểm", "Đạt", "Không đạt", "Cần xem lại", "Tỉ lệ đạt (%)", "Bỏ qua", "Do người xác nhận",
    ]);
    expect(headerOf(wb.getWorksheet("Chi tiết")!)).toContain("Máy kết luận");
    for (const name of ["Tổng hợp", "Chi tiết"]) {
      const ws = wb.getWorksheet(name)!;
      expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
    }
  });

  it("chi tiết ghi ngày dd/mm/yyyy, giờ vào giờ VN, điểm theo thang 100, lý do bằng tiếng Việt", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL" });
    const wb = await load(await uniformToXlsx(await buildUniformReport({ id: emp.id }, yesterday, today)));
    const ws = wb.getWorksheet("Chi tiết")!;
    expect(cell(ws, 2, "Ngày")).toBe(today.split("-").reverse().join("/"));
    expect(cell(ws, 2, "Giờ vào")).toBe("08:05");
    expect(cell(ws, 2, "Điểm màu")).toBe(81);
    expect(cell(ws, 2, "Điểm hình dáng")).toBe(64);
    expect(cell(ws, 2, "Kết luận")).toBe("Không đạt");
    expect(String(cell(ws, 2, "Lý do"))).toContain("không giống mẫu nào");
  });

  it("sheet Ghi chú nói rõ ba mức, ngưỡng đang dùng và bản chạy thử không dùng xử lý nhân sự", async () => {
    const wb = await load(await uniformToXlsx(await buildUniformReport({ id: emp.id }, yesterday, today)));
    const notes = notesOf(wb);
    expect(notes).toContain("Cần xem lại");
    expect(notes).toContain("KHÔNG dùng để xử lý nhân sự");
    expect(notes).toContain("Máy kết luận");
    expect(notes).toMatch(/đạt màu ≥ \d+/);
  });

  it("báo cáo rỗng vẫn mở được, có đủ ba sheet", async () => {
    const wb = await load(await uniformToXlsx(await buildUniformReport({ id: emp.id }, yesterday, today)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Chi tiết", "Ghi chú"]);
    expect(wb.getWorksheet("Tổng hợp")!.rowCount).toBe(1);
  });
});

describe("route tải file", () => {
  it("Nhân sự tải được, tên file DongPhuc_*.xlsx", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId });
    const res = await download(H);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="DongPhuc_${yesterday.replaceAll("-", "")}_${today.replaceAll("-", "")}.xlsx"`);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    const wb = await load(await res.arrayBuffer());
    expect(wb.getWorksheet("Chi tiết")!.rowCount).toBeGreaterThan(1);
  });

  it("Nhân viên thường không có quyền → 403", async () => {
    expect((await download(EMP)).status).toBe(403);
  });

  it("Quản lý chỉ xuất được phòng mình", async () => {
    await seed({ employeeId: emp.id, departmentId: emp.departmentId });
    await seed({ employeeId: admin.id, departmentId: admin.departmentId });
    const wb = await load(await (await download(M)).arrayBuffer());
    const ws = wb.getWorksheet("Chi tiết")!;
    const codes: string[] = [];
    ws.eachRow((r, i) => i > 1 && codes.push(String(r.getCell(colOf(ws, "Mã NV")).value)));
    expect(codes).toContain(emp.code); // cùng phòng với Quản lý
    expect(codes).not.toContain(admin.code);
  });

  it("khoảng ngày ngược hoặc quá 62 ngày → 400", async () => {
    expect((await uniformXlsx.GET(req(`/api/reports/uniform.xlsx?from=${today}&to=${yesterday}`, { cookie: H }), ctx())).status).toBe(400);
    expect((await uniformXlsx.GET(req(`/api/reports/uniform.xlsx?from=${addDays(today, -90)}&to=${today}`, { cookie: H }), ctx())).status).toBe(400);
  });

  it("phòng đang chạy thử được nhắc trong sheet Ghi chú", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "SHADOW" } });
    const dept = await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId }, select: { name: true } });
    const wb = await load(await (await download(H)).arrayBuffer());
    expect(notesOf(wb)).toContain(dept.name);
  });

  it("BẤT BIẾN: xuất đồng phục không làm đổi file bảng công", async () => {
    const range = `?from=${yesterday}&to=${today}`;
    const before = Buffer.from(await (await attendanceXlsx.GET(req(`/api/reports/attendance.xlsx${range}`, { cookie: H }), ctx())).arrayBuffer());
    await seed({ employeeId: emp.id, departmentId: emp.departmentId, status: "FAIL" });
    await download(H);
    const after = Buffer.from(await (await attendanceXlsx.GET(req(`/api/reports/attendance.xlsx${range}`, { cookie: H }), ctx())).arrayBuffer());
    const sheetsOf = async (b: Buffer) => {
      const wb = await load(b);
      return wb.worksheets.map((w) => `${w.name}:${w.rowCount}`).join("|");
    };
    expect(await sheetsOf(after)).toBe(await sheetsOf(before));
    const wb = await load(after);
    expect(headerOf(wb.getWorksheet("Chi tiết")!)).not.toContain("Máy kết luận");
  });
});
