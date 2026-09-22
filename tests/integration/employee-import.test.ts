// v1.8.0: nhập nhân viên hàng loạt từ Excel — file mẫu, xem trước, nhập (tất cả hoặc không), mặc định ô trống, cập nhật ô có điền.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { IMPORT_COLUMNS } from "@/lib/employee-import";
import { BASE, byCode, ctx, req, sessionCookie } from "./helpers";

import * as templateRoute from "@/app/api/employees/import/template/route";
import * as importRoute from "@/app/api/employees/import/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E;
let A: string, H: string, M: string;
const tag = `X${Date.now().toString().slice(-5)}`;

type Row = Partial<Record<(typeof IMPORT_COLUMNS)[number]["key"], string | number | Date>>;
async function xlsx(rows: Row[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nhân viên");
  ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  for (const r of rows) ws.addRow(IMPORT_COLUMNS.map((c) => r[c.key] ?? null));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const post = (cookie: string, body: Buffer | Uint8Array, q = "") =>
  importRoute.POST(
    new NextRequest(new URL(`/api/employees/import?${q}`, BASE), { method: "POST", headers: { cookie, "content-type": "application/octet-stream" }, body: new Uint8Array(body) }),
    ctx(),
  );

beforeAll(async () => {
  [admin, hr, mgr] = await Promise.all(["NV001", "NV016", "NV003"].map(byCode));
  [A, H, M] = await Promise.all([admin, hr, mgr].map((e) => sessionCookie(e.id)));
});
afterAll(async () => {
  const ids = (await prisma.employee.findMany({ where: { code: { startsWith: tag } }, select: { id: true } })).map((e) => e.id);
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.department.deleteMany({ where: { name: "Chưa phân phòng", employees: { none: {} } } });
});

describe("file mẫu", () => {
  it("đủ cột, sheet DanhMuc ẩn, ô Phòng ban có danh sách thả xuống; Quản lý (không có employees.manage) → 403", async () => {
    const res = await templateRoute.GET(req("/api/employees/import/template", { cookie: H }), ctx());
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet("Nhân viên")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(IMPORT_COLUMNS.map((c) => c.header));
    expect(wb.getWorksheet("DanhMuc")!.state).toBe("hidden");
    const deptCol = IMPORT_COLUMNS.findIndex((c) => c.key === "department") + 1;
    expect(ws.getCell(2, deptCol).dataValidation?.type).toBe("list");
    // HR (không có roles.assignPrivileged) không được chọn Quản trị trong danh sách vai trò.
    const roleList = (wb.getWorksheet("DanhMuc")!.getColumn(7).values as unknown[]).map(String);
    expect(roleList).not.toContain("Quản trị");
    expect((await templateRoute.GET(req("/api/employees/import/template", { cookie: M }), ctx())).status).toBe(403);
  });
});

describe("xem trước & nhập", () => {
  it("xem trước phân loại dòng lỗi (thiếu tên, phòng sai chính tả, SĐT trùng trong file/DB, CCCD sai) — không ghi gì", async () => {
    const existingPhone = (await byCode("NV007")).phone!;
    const buf = await xlsx([
      { code: `${tag}1`, name: "Nguyễn Văn Một" },
      { code: `${tag}2` },
      { code: `${tag}3`, name: "Sai Phòng", department: "Ke toan xyz" },
      { code: `${tag}4`, name: "Trùng SĐT A", phone: "0987000111" },
      { code: `${tag}5`, name: "Trùng SĐT B", phone: "0987000111" },
      { code: `${tag}6`, name: "SĐT Có Rồi", phone: existingPhone },
      { code: `${tag}7`, name: "CCCD Sai", nationalId: "12345" },
      // Ô số Excel mất số 0 đầu: sau khi chuẩn hóa vẫn phải phát hiện trùng với người đã có.
      { code: `${tag}8`, name: "Số Mất Không", phone: Number(existingPhone) },
      { code: `${tag}9`, name: "Có Khoảng Trắng", phone: "0987 000 333" },
    ]);
    const res = await post(H, buf);
    expect(res.status).toBe(200);
    const body = await res.json();
    const by = (code: string) => body.items.find((i: { code: string }) => i.code === code);
    expect(by(`${tag}1`).action).toBe("CREATE");
    expect(by(`${tag}2`).errors.join()).toContain("thiếu Họ tên");
    expect(by(`${tag}3`).errors.join()).toContain("không có trong danh mục");
    expect(by(`${tag}4`).action).toBe("CREATE");
    expect(by(`${tag}5`).errors.join()).toContain("trùng với dòng");
    expect(by(`${tag}6`).errors.join()).toContain("đã được dùng");
    expect(by(`${tag}7`).errors.join()).toContain("CCCD");
    expect(by(`${tag}8`).errors.join()).toContain("đã được dùng");
    expect(by(`${tag}9`)).toMatchObject({ action: "CREATE" });
    expect(body.summary.errors).toBe(6);
    expect(await prisma.employee.count({ where: { code: { startsWith: tag } } })).toBe(0);
    // Nhập thật khi còn lỗi → 400, không tạo ai.
    expect((await post(H, buf, "mode=commit")).status).toBe(400);
    expect(await prisma.employee.count({ where: { code: { startsWith: tag } } })).toBe(0);
  });

  it("nhập hợp lệ: chỉ Mã + Tên → phòng 'Chưa phân phòng', ca mặc định, mật khẩu tạm dùng được; đủ cột → đúng danh mục", async () => {
    const shift = await prisma.shift.findFirstOrThrow({ orderBy: { id: "asc" } });
    const dept = await prisma.department.findUniqueOrThrow({ where: { id: mgr.departmentId } });
    const buf = await xlsx([
      { code: `${tag}a`, name: "Chỉ Có Tên" },
      {
        code: `${tag}b`,
        name: "Đủ Thông Tin",
        phone: 987000222,
        nationalId: "79190000555", // Excel làm mất số 0 đầu → hiểu là 079190000555
        dateOfBirth: "05/03/1990",
        gender: "Nữ",
        address: "12 Lê Lợi",
        department: dept.name.toUpperCase(),
        role: "Quản lý",
        scheduleType: "Xoay ca",
      },
    ]);
    const res = await post(H, buf, `mode=commit&defaultShiftId=${shift.id}&defaultPatternId=none`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 2, updated: 0 });
    const a = await prisma.employee.findUniqueOrThrow({ where: { code: `${tag}A` }, include: { department: true } });
    expect(a.department.name).toBe("Chưa phân phòng");
    expect(a).toMatchObject({ defaultShiftId: shift.id, role: "EMPLOYEE", scheduleType: "FIXED", phone: null, mustChangePassword: true });
    // v1.12.1: ca cố định luôn có mẫu tuần — "không mẫu" → mẫu tương đương T2–T7 = ca mặc định, CN nghỉ.
    const pat = await prisma.workPattern.findUniqueOrThrow({ where: { id: a.workPatternId! } });
    expect([pat.monShiftId, pat.satShiftId, pat.sunShiftId]).toEqual([shift.id, shift.id, null]);
    expect(await prisma.scheduleAssignment.count({ where: { employeeId: a.id } })).toBe(1);
    const b = await prisma.employee.findUniqueOrThrow({ where: { code: `${tag}B` } });
    expect(b).toMatchObject({ phone: "0987000222", nationalId: "079190000555", dateOfBirth: "1990-03-05", gender: "NU", departmentId: dept.id, role: "MANAGER", scheduleType: "ROTATING" });
    // File kết quả có mật khẩu tạm đăng nhập được.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(Buffer.from(body.resultFile, "base64")).buffer);
    const rows = wb.getWorksheet("Kết quả nhập")!.getSheetValues().slice(2) as unknown[][];
    const rowA = rows.find((r) => r?.[1] === `${tag}A`)!;
    expect(await bcrypt.compare(String(rowA[5]), a.passwordHash)).toBe(true);
    // Một tin nhóm minh bạch tổng hợp, nhật ký không chứa CCCD.
    expect(await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: `grp:emp-import:${hr.id}:` } } })).toBeGreaterThanOrEqual(1);
    const logs = await prisma.auditLog.findMany({ where: { entityId: String(b.id) } });
    for (const l of logs) expect(l.detail ?? "").not.toContain("079190000555");
  });

  it("mã đã có → chỉ cập nhật ô có điền; vai trò bị bỏ qua kèm cảnh báo; không đổi gì → Không đổi", async () => {
    const before = await prisma.employee.findUniqueOrThrow({ where: { code: `${tag}B` } });
    const buf = await xlsx([{ code: `${tag}b`, address: "34 Hai Bà Trưng", role: "Nhân viên" }, { code: `${tag}a`, name: "Chỉ Có Tên" }]);
    const prev = await (await post(H, buf)).json();
    const b = prev.items.find((i: { code: string }) => i.code === `${tag}B`);
    expect(b.action).toBe("UPDATE");
    expect(b.changes).toEqual(["địa chỉ"]);
    expect(b.warnings.join()).toContain("vai trò");
    expect(prev.items.find((i: { code: string }) => i.code === `${tag}A`).action).toBe("NOCHANGE");
    expect((await post(H, buf, "mode=commit")).status).toBe(200);
    const after = await prisma.employee.findUniqueOrThrow({ where: { code: `${tag}B` } });
    expect(after).toMatchObject({ address: "34 Hai Bà Trưng", role: before.role, nationalId: before.nationalId, phone: before.phone });
  });

  it("HR nhập vai trò Quản trị → lỗi; file không phải xlsx → 400", async () => {
    const res = await post(H, await xlsx([{ code: `${tag}z`, name: "Leo Thang", role: "Quản trị" }]));
    expect((await res.json()).items[0].action).toBe("ERROR");
    expect((await post(H, Buffer.from("xin chao"))).status).toBe(400);
    expect((await post(A, await xlsx([{ code: `${tag}z`, name: "Leo Thang", role: "Quản trị" }]))).status).toBe(200);
  });
});
