// QC xuất Excel sau khi chuyển xlsx -> exceljs: cấu trúc sheet, kiểu ô, ký tự đặc biệt, báo cáo rỗng/lớn.
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { byCode, ctx, readXlsx, req, sessionCookie } from "./helpers";
import { reportToXlsx, type DetailRow, type SummaryRow } from "@/lib/reports";
import * as xlsxRoute from "@/app/api/reports/attendance.xlsx/route";

const SUMMARY_HEADERS = [
  "Mã NV", "Họ tên", "Phòng ban", "Chức danh", "Chuyên khoa", "Ngày công", "Giờ công", "Số lần trễ", "Tổng phút trễ", "Số lần về sớm",
  "Tổng phút về sớm", "Giờ OT", "Ngày nghỉ phép", "Ngày vắng không phép", "Số ngày thiếu giờ ra", "Số lần bổ sung công",
];
const DETAIL_HEADERS = ["Mã NV", "Họ tên", "Phòng ban", "Chức danh", "Chuyên khoa", "Ngày", "Ca", "Giờ vào", "Giờ ra", "Phút trễ", "Phút sớm", "Phút OT", "Công", "Giờ công", "Trạng thái", "Ghi chú"];

async function load(buf: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}
const headerOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);

const sum = (o: Partial<SummaryRow> = {}): SummaryRow => ({
  employeeId: 1, code: "007", name: "Nguyễn Thị Ánh Tuyết", department: "Phòng Kế toán – Tài vụ", jobTitle: "Kế toán", specialty: "",
  workDays: 0.5, workMinutes: 270, lateCount: 1, lateMinutes: 5, earlyCount: 0, earlyMinutes: 0,
  otMinutes: 50, leaveDays: 0.5, absentDays: 0, missingOutDays: 0, correctionCount: 0, ...o,
});
const det = (o: Partial<DetailRow> = {}): DetailRow => ({
  employeeId: 1, code: "007", name: "Nguyễn Thị Ánh Tuyết", department: "Phòng Kế toán – Tài vụ", jobTitle: "Kế toán", specialty: "", date: "2026-09-01",
  shift: "Ca sáng 08:00–12:00", inTime: "08:05", outTime: "", lateMinutes: 5, earlyMinutes: 0, otMinutes: 0,
  workDayUnits: 0.5, workMinutes: 235, status: "Đi trễ", note: "", ...o,
});

describe("reportToXlsx (exceljs)", () => {
  it("báo cáo rỗng: vẫn 2 sheet, có dòng tiêu đề, không có sheet Ghi chú", async () => {
    const wb = await load(await reportToXlsx({ summary: [], detail: [] }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Chi tiết"]);
    expect(headerOf(wb.getWorksheet("Tổng hợp")!)).toEqual(SUMMARY_HEADERS);
    expect(headerOf(wb.getWorksheet("Chi tiết")!)).toEqual(DETAIL_HEADERS);
    expect(wb.getWorksheet("Tổng hợp")!.rowCount).toBe(1);
  });

  it("giữ độ rộng cột, số lẻ 0.5 là ô số, mã NV '007' là chuỗi, tiếng Việt nguyên vẹn", async () => {
    const wb = await load(await reportToXlsx({ summary: [sum()], detail: [det()] }));
    const s = wb.getWorksheet("Tổng hợp")!;
    const widths = (ws: ExcelJS.Worksheet) => ws.columns.map((c) => c.width);
    expect(widths(s)).toEqual([8, 24, 22, 14, 16, 10, 9.5, 10, 13, 13, 16, 8, 14, 18, 18, 18]);
    const d = wb.getWorksheet("Chi tiết")!;
    expect(widths(d)).toEqual([8, 24, 22, 14, 16, 11, 26, 8, 8, 9.5, 9.5, 9.5, 6, 9.5, 16, 50]);

    const r = s.getRow(2);
    expect(r.getCell(1).value).toBe("007");
    expect(r.getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(r.getCell(2).value).toBe("Nguyễn Thị Ánh Tuyết");
    expect(r.getCell(3).value).toBe("Phòng Kế toán – Tài vụ");
    expect(r.getCell(4).value).toBe("Kế toán"); // Chức danh (v1.7.0)
    expect(r.getCell(6).value).toBe(0.5);
    expect(r.getCell(6).type).toBe(ExcelJS.ValueType.Number);
    expect(r.getCell(12).value).toBe(0.83); // 50 phút OT -> 0.83 giờ
    expect(r.getCell(13).value).toBe(0.5);

    const dr = d.getRow(2);
    expect(dr.getCell(7).value).toBe("Ca sáng 08:00–12:00");
    expect(dr.getCell(13).value).toBe(0.5);
    expect(dr.getCell(13).type).toBe(ExcelJS.ValueType.Number);
    // Ô chuỗi rỗng không được biến thành số/lỗi.
    expect([null, ""]).toContain(dr.getCell(9).value);
  });

  // exceljs bỏ qua cột có width đúng bằng 9 (DEFAULT_COLUMN_WIDTH) khi ghi file => reports.ts dùng 9.5.
  it("cột hẹp (Giờ công, Phút trễ/sớm/OT) giữ đúng độ rộng sau khi ghi file", async () => {
    const wb = await load(await reportToXlsx({ summary: [sum()], detail: [det()] }));
    expect(wb.getWorksheet("Tổng hợp")!.getColumn(7).width).toBe(9.5);
    expect(wb.getWorksheet("Chi tiết")!.getColumn(10).width).toBe(9.5);
  });

  it("chuỗi bắt đầu bằng '=' không bị hiểu là công thức; ký tự điều khiển không làm hỏng file", async () => {
    const buf = await reportToXlsx({
      summary: [sum({ name: "=HYPERLINK(\"http://x\",\"a\")" })],
      detail: [det({ note: "Đơn #1 <Nghỉ phép> & \"x\"\u0001\u0008 'y'", name: "+1-2" })],
    });
    const wb = await load(buf);
    const c = wb.getWorksheet("Tổng hợp")!.getRow(2).getCell(2);
    expect(c.type).toBe(ExcelJS.ValueType.String);
    expect(c.value).toBe("=HYPERLINK(\"http://x\",\"a\")");
    const d = wb.getWorksheet("Chi tiết")!.getRow(2);
    expect(d.getCell(2).value).toBe("+1-2");
    expect(d.getCell(16).value).toBe("Đơn #1 <Nghỉ phép> & \"x\" 'y'");
  });

  it("sheet Ghi chú: tiêu đề + mỗi ghi chú một dòng, rộng 100", async () => {
    const notes = ["Tháng 08/2026 đã chốt công lúc 17:00 31/08/2026 — số liệu lấy từ bản chốt.", "Dòng 2"];
    const wb = await load(await reportToXlsx({ summary: [sum()], detail: [] }, notes));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Chi tiết", "Ghi chú"]);
    const g = wb.getWorksheet("Ghi chú")!;
    expect(g.getColumn(1).width).toBe(100);
    expect(g.getRow(1).getCell(1).value).toBe("Ghi chú");
    expect(g.getRow(2).getCell(1).value).toBe(notes[0]);
    expect(g.getRow(3).getCell(1).value).toBe("Dòng 2");
    expect(g.rowCount).toBe(3);
  });

  it("báo cáo lớn (300 NV x 62 ngày) xuất được trong thời gian hợp lý", async () => {
    const detail: DetailRow[] = [];
    for (let e = 0; e < 300; e++) for (let d = 0; d < 62; d++) detail.push(det({ employeeId: e, code: `NV${e}`, note: "Đơn #12 Nghỉ phép; Thiếu giờ ra" }));
    const t = Date.now();
    const buf = await reportToXlsx({ summary: Array.from({ length: 300 }, (_, i) => sum({ employeeId: i })), detail });
    expect(Date.now() - t).toBeLessThan(20_000);
    const wb = await readXlsx(new Uint8Array(buf).buffer);
    expect(wb.rows("Chi tiết")).toHaveLength(300 * 62);
    expect(wb.rows("Tổng hợp")).toHaveLength(300);
  });
});

describe("route xuất Excel — kỳ không có dữ liệu", () => {
  let cookie: string;
  beforeAll(async () => {
    cookie = await sessionCookie((await byCode("NV001")).id);
  });
  it("kỳ ở quá khứ xa: trả file hợp lệ, có tiêu đề cột", async () => {
    const res = await xlsxRoute.GET(req(`/api/reports/attendance.xlsx?from=2001-01-01&to=2001-01-31`, { cookie }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const wb = await load(await res.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Chi tiết"]);
    expect(headerOf(wb.getWorksheet("Chi tiết")!)).toEqual(DETAIL_HEADERS);
  });
});
