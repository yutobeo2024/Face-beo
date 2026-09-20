/** Mẫu Excel "Giờ vào/ra theo ngày" (v1.5.2): 3 dòng tiêu đề, IN/OUT từng ngày, tô màu Chủ nhật, phạm vi phòng ban. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { addDays, startOfWeek, todayVN, vnDateTime, weekday } from "@/lib/attendance";
import { recordScan } from "@/lib/attendance-service";
import { ctx, req, sessionCookie } from "./helpers";
import * as route from "@/app/api/reports/inout.xlsx/route";

const tag = `IO${randomUUID().slice(0, 6)}`.toUpperCase();
let deptA: number, deptB: number, shiftId: number;
let admin: number, mgrB: number, empA: number, empA2: number, empB: number;
let A: string, MB: string, EA: string;
let SAT: string, SUN: string, MON: string; // kỳ 3 ngày T7–T2 của 4 tuần trước

async function mk(role: string, departmentId: number) {
  return (await prisma.employee.create({ data: {
    code: `${tag}${randomInt(9000) + 1000}`, name: `${tag} ${role} ${departmentId}`, phone: `09${randomInt(100000000).toString().padStart(8, "0")}`,
    passwordHash: await bcrypt.hash("Fixture123", 4), role, departmentId, defaultShiftId: shiftId, mustChangePassword: false,
  } })).id;
}
const get = (cookie: string | undefined, qs: string) => route.GET(req(`/api/reports/inout.xlsx?${qs}`, { cookie }), ctx());
async function load(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}
const cell = (ws: ExcelJS.Worksheet, r: number, c: number) => ws.getCell(r, c).value;
function sheetText(ws: ExcelJS.Worksheet) {
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => out.push(String(c.value ?? ""))));
  return out.join("|");
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  shiftId = (await prisma.shift.create({ data: { name: `${tag} HC`, startTime: "08:00", endTime: "17:00", breakMinutes: 60 } })).id;
  deptA = (await prisma.department.create({ data: { name: `${tag} A` } })).id;
  deptB = (await prisma.department.create({ data: { name: `${tag} B` } })).id;
  admin = await mk("ADMIN", deptB); // để phòng A chỉ có 2 nhân viên => dòng 4, 5
  mgrB = await mk("MANAGER", deptB);
  empA = await mk("EMPLOYEE", deptA);
  empA2 = await mk("EMPLOYEE", deptA);
  empB = await mk("EMPLOYEE", deptB);
  await prisma.department.update({ where: { id: deptB }, data: { managerId: mgrB } });
  [A, MB, EA] = await Promise.all([admin, mgrB, empA].map(sessionCookie));
  const base = addDays(startOfWeek(todayVN()), -28);
  SAT = addDays(base, 5); SUN = addDays(base, 6); MON = addDays(base, 7);
  expect(weekday(SUN)).toBe(7);
  const scan = (id: number, d: string, t: string) => recordScan({ employeeId: id, checkTime: vnDateTime(d, t), source: "MANUAL", createdById: admin });
  await scan(empA, SAT, "07:58"); await scan(empA, SAT, "17:05"); // 2 lần quét: IN + OUT
  await scan(empA, MON, "08:10"); // 1 lần quét: chỉ IN
  await scan(empA2, SUN, "09:00"); await scan(empA2, SUN, "11:30"); // làm Chủ nhật
  await scan(empB, MON, "07:50"); await scan(empB, MON, "16:55");
});

afterAll(async () => {
  const ids = [admin, mgrB, empA, empA2, empB];
  await prisma.department.updateMany({ where: { managerId: { in: ids } }, data: { managerId: null } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.department.deleteMany({ where: { id: { in: [deptA, deptB] } } });
  await prisma.shift.deleteMany({ where: { id: shiftId } });
});

describe("GET /api/reports/inout.xlsx", () => {
  it("3 dòng tiêu đề, mỗi ngày 2 cột IN/OUT, giờ VN 24h, chỉ 1 lần quét => OUT trống, Chủ nhật tô màu, freeze 3x3", async () => {
    const res = await get(A, `from=${SAT}&to=${MON}&departmentId=${deptA}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`GioVaoRa_${SAT.replaceAll("-", "")}_${MON.replaceAll("-", "")}.xlsx`);
    const wb = await load(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Giờ vào ra", "Ghi chú"]);
    const ws = wb.getWorksheet("Giờ vào ra")!;
    // Tiêu đề cố định + tiêu đề ngày
    expect([cell(ws, 3, 1), cell(ws, 3, 2), cell(ws, 3, 3)]).toEqual(["STT", "Nhân viên", "Bộ phận"]);
    expect(cell(ws, 1, 4)).toBe(SAT.split("-").reverse().join("/"));
    expect(cell(ws, 2, 4)).toBe("T7");
    expect([cell(ws, 3, 4), cell(ws, 3, 5)]).toEqual(["IN", "OUT"]);
    expect(cell(ws, 2, 6)).toBe("CN");
    expect(cell(ws, 2, 8)).toBe("T2");
    expect(ws.getCell(1, 4).isMerged).toBe(true);
    expect(ws.getCell(1, 1).isMerged).toBe(false); // không merge dọc để bộ lọc/sort của Excel hoạt động
    expect(ws.autoFilter).toBe("A3:I3"); // bộ lọc phủ đủ 9 cột (3 cố định + 3 ngày × 2)
    // Dòng dữ liệu (thứ tự theo mã)
    const rows = [4, 5].map((r) => ({ stt: cell(ws, r, 1), name: cell(ws, r, 2), dept: cell(ws, r, 3), satIn: cell(ws, r, 4), satOut: cell(ws, r, 5), sunIn: cell(ws, r, 6), sunOut: cell(ws, r, 7), monIn: cell(ws, r, 8), monOut: cell(ws, r, 9) }));
    const ra = rows.find((x) => x.name === `${tag} EMPLOYEE ${deptA}` && x.satIn === "07:58")!;
    expect(ra).toMatchObject({ dept: `${tag} A`, satIn: "07:58", satOut: "17:05", monIn: "08:10" });
    expect(ra.monOut ?? null).toBeNull(); // chỉ 1 lần quét
    expect(ra.sunIn ?? null).toBeNull();
    const ra2 = rows.find((x) => x.sunIn === "09:00")!;
    expect(ra2).toMatchObject({ sunIn: "09:00", sunOut: "11:30" });
    expect(rows.map((x) => x.stt)).toEqual([1, 2]);
    expect(cell(ws, 6, 2) ?? null).toBeNull(); // không có nhân viên phòng B
    // Chủ nhật tô hồng (tiêu đề và ô dữ liệu), thứ Bảy không
    const sunFill = ws.getCell(2, 6).fill as ExcelJS.FillPattern;
    expect(sunFill?.fgColor?.argb).toBe("FFF4B6B6");
    expect((ws.getCell(4, 6).fill as ExcelJS.FillPattern)?.fgColor?.argb).toBe("FFF4B6B6");
    expect((ws.getCell(4, 4).fill as ExcelJS.FillPattern)?.fgColor?.argb).not.toBe("FFF4B6B6");
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 3, ySplit: 3 });
    expect(sheetText(wb.getWorksheet("Ghi chú")!)).toContain("IN = lần quét đầu");
  });
  it("phạm vi: Quản lý phòng B chỉ thấy phòng B, không lộ nhân viên phòng A; nhân viên 403; ẩn danh 401; quá 62 ngày 400", async () => {
    const res = await get(MB, `from=${SAT}&to=${MON}`);
    expect(res.status).toBe(200);
    const ws = (await load(res)).getWorksheet("Giờ vào ra")!;
    const text = sheetText(ws);
    expect(text).toContain(`${tag} EMPLOYEE ${deptB}`);
    expect(text).not.toContain(`${tag} EMPLOYEE ${deptA}`);
    expect(text).toContain("07:50");
    expect((await get(MB, `from=${SAT}&to=${MON}&departmentId=${deptA}`)).status).toBe(200); // phòng ngoài phạm vi => file rỗng, không lộ
    expect(sheetText((await load(await get(MB, `from=${SAT}&to=${MON}&departmentId=${deptA}`))).getWorksheet("Giờ vào ra")!)).not.toContain(tag);
    expect((await get(EA, `from=${SAT}&to=${MON}`)).status).toBe(403);
    expect((await get(undefined, `from=${SAT}&to=${MON}`)).status).toBe(401);
    expect((await get(A, `from=${SAT}&to=${addDays(SAT, 70)}`)).status).toBe(400);
    expect((await get(A, `from=${MON}&to=${SAT}`)).status).toBe(400);
  });
});
