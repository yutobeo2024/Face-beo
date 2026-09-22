/** Bảng công tổng hợp + chi tiết, xuất Excel phía server (PRD mục 5). */
import ExcelJS from "exceljs";
import { prisma } from "./db";
import { TRACKED_WHERE } from "./attendance-scope";
import { summarizeRange } from "./attendance-service";
import { lockedMonths } from "./payroll-lock-state";
import { addDays, vnDayRange, vnTime, weekday, type DayStatus } from "./attendance";
import { fmtDay, WEEKDAY_SHORT } from "./client/format";
import { REQUEST_TYPE_LABEL, type RequestTypeT } from "./roles";

export const STATUS_LABEL: Record<DayStatus, string> = {
  DAY_OFF: "Nghỉ",
  HOLIDAY: "Ngày lễ",
  ON_LEAVE: "Nghỉ có phép",
  NOT_YET: "Chưa đến ca",
  ABSENT: "Vắng không phép",
  ON_TIME: "Đúng giờ",
  LATE: "Đi trễ",
  OUT_OF_SHIFT: "Ngoài ca",
  NO_SCHEDULE: "Chưa có lịch",
};

/** Làm tròn 2 chữ số thập phân (tránh sai số cộng dồn 0.1 + 0.2). */
const r2 = (n: number) => Math.round(n * 100) / 100;

export type SummaryRow = {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  /** Chức danh / chuyên khoa HIỆN TẠI của nhân viên (giống tên, mã: không chụp theo tháng đã chốt). */
  jobTitle: string;
  specialty: string;
  /** Tổng ngày công theo hệ số (có thể lẻ 0.5). */
  workDays: number;
  workMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  otMinutes: number;
  leaveDays: number;
  absentDays: number;
  missingOutDays: number;
  correctionCount: number;
};

export type DetailRow = {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  jobTitle: string;
  specialty: string;
  date: string;
  shift: string;
  inTime: string;
  outTime: string;
  lateMinutes: number;
  earlyMinutes: number;
  otMinutes: number;
  workDayUnits: number;
  workMinutes: number;
  status: string;
  note: string;
};

type ReportScope = { departmentId?: number | { in: number[] }; id?: number };

type ScopeParts = { deptIds: number[] | null; deptOk: (d: number | null | undefined) => boolean };
function scopeParts(where: object): ScopeParts {
  const deptFilter = (where as ReportScope).departmentId;
  const deptOk = (d: number | null | undefined) =>
    deptFilter === undefined ? true : d == null ? false : typeof deptFilter === "number" ? d === deptFilter : deptFilter.in.includes(d);
  const deptIds = deptFilter === undefined ? null : typeof deptFilter === "number" ? [deptFilter] : deptFilter.in;
  return { deptIds, deptOk };
}

/**
 * Nhân viên thuộc kỳ báo cáo: đang làm, hoặc nghỉ việc sau ngày bắt đầu, hoặc có trong bản chụp tháng đã chốt;
 * lọc phòng gồm cả người từng thuộc phòng trong kỳ (lịch sử phân công) để tách đúng ngày theo phòng.
 */
export async function listReportEmployees(where: object, from: string, to: string) {
  const scope = where as ReportScope;
  const { deptIds } = scopeParts(where);
  const months = [...(await lockedMonths())].filter((m) => m >= from.slice(0, 7) && m <= to.slice(0, 7));
  const frozen = months.length
    ? await prisma.lockedDay.findMany({
        where: { month: { in: months }, workDate: { gte: from, lte: to }, ...(deptIds ? { departmentId: { in: deptIds } } : {}) },
        select: { employeeId: true },
        distinct: ["employeeId"],
      })
    : [];
  const movedIn = deptIds
    ? await prisma.scheduleAssignment.findMany({ where: { departmentId: { in: deptIds }, effectiveFrom: { lte: to } }, select: { employeeId: true }, distinct: ["employeeId"] })
    : [];
  return prisma.employee.findMany({
    where: {
      ...(scope.id !== undefined ? { id: scope.id } : {}),
      AND: [
        { OR: [{ active: true }, { leftAt: { gte: vnDayRange(from).start } }, { id: { in: frozen.map((x) => x.employeeId) } }] },
        deptIds ? { OR: [{ departmentId: { in: deptIds } }, { id: { in: [...frozen, ...movedIn].map((x) => x.employeeId) } }] } : {},
        // v1.12.0: người "không chấm công" không có trong báo cáo — trừ khi đã nằm trong bản chụp tháng đã chốt (lịch sử bất biến).
        { OR: [TRACKED_WHERE, { id: { in: frozen.map((x) => x.employeeId) } }] },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
      jobTitle: { select: { name: true } },
      specialty: { select: { name: true } },
    },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
  });
}

/**
 * `where` là phạm vi nhân viên (employeeScopeWhere: theo phòng ban hoặc id).
 * Lọc phòng ban THEO TỪNG NGÀY (phòng của nhân viên vào ngày đó; tháng đã chốt lấy từ bản chụp) —
 * chuyển phòng giữa kỳ không làm đổi báo cáo của phòng cũ trong tháng đã chốt.
 */
export async function buildAttendanceReport(where: object, from: string, to: string, now = new Date()) {
  const { deptOk } = scopeParts(where);
  const emps = await listReportEmployees(where, from, to);
  const deptName = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const ids = emps.map((e) => e.id);
  const { summaries, planner, requests } = await summarizeRange(ids, from, to, now);
  const reqById = new Map(requests.map((r) => [r.id, r]));
  // Số lần bổ sung công đã được chấm tay trong kỳ (chống lạm dụng quên chấm).
  const corrRows = await prisma.leaveRequest.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: ids }, type: "BO_SUNG_CONG", executedAt: { not: null }, correctionAt: { gte: vnDayRange(from).start, lt: vnDayRange(to).end } },
    _count: true,
  });
  const corrections = new Map(corrRows.map((c) => [c.employeeId, c._count]));
  const summary: SummaryRow[] = [];
  const detail: DetailRow[] = [];

  for (const e of emps) {
    const row: SummaryRow = {
      employeeId: e.id,
      code: e.code,
      name: e.name,
      department: e.department.name,
      jobTitle: e.jobTitle?.name ?? "",
      specialty: e.specialty?.name ?? "",
      workDays: 0,
      workMinutes: 0,
      lateCount: 0,
      lateMinutes: 0,
      earlyCount: 0,
      earlyMinutes: 0,
      otMinutes: 0,
      leaveDays: 0,
      absentDays: 0,
      missingOutDays: 0,
      correctionCount: corrections.get(e.id) ?? 0,
    };
    let days = 0;
    let lastDept: number | null | undefined = null;
    for (const [k, s] of summaries) {
      if (!k.startsWith(`${e.id}|`)) continue;
      const dayDept = s.departmentId ?? e.departmentId;
      if (!deptOk(dayDept)) continue;
      days++;
      lastDept = dayDept;
      row.workDays += s.workDayUnits;
      row.workMinutes += s.workMinutes;
      if (s.isLate) {
        row.lateCount++;
        row.lateMinutes += s.lateMinutes;
      }
      if (s.isEarly) {
        row.earlyCount++;
        row.earlyMinutes += s.earlyMinutes;
      }
      row.otMinutes += s.otMinutes;
      row.leaveDays += s.leaveDayUnits;
      if (s.status === "ABSENT") row.absentDays++;
      if (s.missingOut) row.missingOutDays++;

      if (!s.plan.shift && s.logs.length === 0 && !s.plan.isHoliday) continue;
      const notes: string[] = [];
      for (const id of s.relatedRequestIds) {
        const r = reqById.get(id);
        if (r) notes.push(`Đơn #${id} ${REQUEST_TYPE_LABEL[r.type as RequestTypeT] ?? r.type}`);
      }
      if (s.pendingLeave) notes.push("Có đơn nghỉ chờ duyệt");
      if (s.hasManual) notes.push("Sửa thủ công");
      if (s.holidayWork) notes.push(`Làm ngày lễ (${planner.holidayNames.get(s.workDate) ?? ""})`);
      if (s.missingOut) notes.push("Thiếu giờ ra");
      detail.push({
        employeeId: e.id,
        code: e.code,
        name: e.name,
        department: deptName.get(dayDept) ?? e.department.name,
        jobTitle: e.jobTitle?.name ?? "",
        specialty: e.specialty?.name ?? "",
        date: s.workDate,
        shift: s.shift ? `${s.shift.name} ${s.shift.startTime}–${s.shift.endTime}` : "",
        inTime: s.inTime ? vnTime(s.inTime) : "",
        outTime: s.outTime ? vnTime(s.outTime) : "",
        lateMinutes: s.lateMinutes,
        earlyMinutes: s.earlyMinutes,
        otMinutes: s.otMinutes,
        workDayUnits: r2(s.workDayUnits),
        workMinutes: s.workMinutes,
        status: STATUS_LABEL[s.status],
        note: notes.join("; "),
      });
    }
    if (!days) continue; // không có ngày nào thuộc phòng đang xem
    if (lastDept != null) row.department = deptName.get(lastDept) ?? row.department;
    // Làm tròn một lần ở cuối (không làm tròn từng bước để tổng không bị lệch).
    row.workDays = r2(row.workDays);
    row.leaveDays = r2(row.leaveDays);
    summary.push(row);
  }
  return { summary, detail };
}

/** Thêm một sheet từ danh sách object (dòng đầu là tiêu đề), kèm độ rộng cột. */
function addSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, string | number>[], widths: number[], headers?: string[]) {
  const ws = wb.addWorksheet(name);
  const cols = headers ?? Object.keys(rows[0] ?? {});
  ws.columns = cols.map((h, i) => ({ header: h, key: h, width: widths[i] ?? 12 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  return ws;
}

const SUMMARY_HEADERS = [
  "Mã NV",
  "Họ tên",
  "Phòng ban",
  "Chức danh",
  "Chuyên khoa",
  "Ngày công",
  "Giờ công",
  "Số lần trễ",
  "Tổng phút trễ",
  "Số lần về sớm",
  "Tổng phút về sớm",
  "Giờ OT",
  "Ngày nghỉ phép",
  "Ngày vắng không phép",
  "Số ngày thiếu giờ ra",
  "Số lần bổ sung công",
];
const DETAIL_HEADERS = ["Mã NV", "Họ tên", "Phòng ban", "Chức danh", "Chuyên khoa", "Ngày", "Ca", "Giờ vào", "Giờ ra", "Phút trễ", "Phút sớm", "Phút OT", "Công", "Giờ công", "Trạng thái", "Ghi chú"];

export async function reportToXlsx(r: { summary: SummaryRow[]; detail: DetailRow[] }, notes: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Face Beo";
  addSheet(
    wb,
    "Tổng hợp",
    r.summary.map((x) => ({
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
      "Chức danh": x.jobTitle,
      "Chuyên khoa": x.specialty,
      "Ngày công": x.workDays,
      "Giờ công": r2(x.workMinutes / 60),
      "Số lần trễ": x.lateCount,
      "Tổng phút trễ": x.lateMinutes,
      "Số lần về sớm": x.earlyCount,
      "Tổng phút về sớm": x.earlyMinutes,
      "Giờ OT": r2(x.otMinutes / 60),
      "Ngày nghỉ phép": x.leaveDays,
      "Ngày vắng không phép": x.absentDays,
      "Số ngày thiếu giờ ra": x.missingOutDays,
      "Số lần bổ sung công": x.correctionCount,
    })),
    [8, 24, 22, 14, 16, 10, 9.5, 10, 13, 13, 16, 8, 14, 18, 18, 18],
    SUMMARY_HEADERS,
  );
  addSheet(
    wb,
    "Chi tiết",
    r.detail.map((x) => ({
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
      "Chức danh": x.jobTitle,
      "Chuyên khoa": x.specialty,
      "Ngày": x.date.split("-").reverse().join("/"),
      "Ca": x.shift,
      "Giờ vào": x.inTime,
      "Giờ ra": x.outTime,
      "Phút trễ": x.lateMinutes,
      "Phút sớm": x.earlyMinutes,
      "Phút OT": x.otMinutes,
      "Công": x.workDayUnits,
      "Giờ công": r2(x.workMinutes / 60),
      "Trạng thái": x.status,
      "Ghi chú": x.note,
    })),
    [8, 24, 22, 14, 16, 11, 26, 8, 8, 9.5, 9.5, 9.5, 6, 9.5, 16, 50],
    DETAIL_HEADERS,
  );
  if (notes.length) addSheet(wb, "Ghi chú", notes.map((n) => ({ "Ghi chú": n })), [100], ["Ghi chú"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Mẫu 2: ma trận giờ vào/ra theo ngày (IN = lần quét đầu, OUT = lần quét cuối)
// ---------------------------------------------------------------------------

export type InOutMatrix = {
  from: string;
  to: string;
  dates: string[];
  holidays: Map<string, string>;
  rows: { code: string; name: string; department: string; jobTitle: string; days: Record<string, { in: string; out: string }> }[];
};

export async function buildInOutMatrix(where: object, from: string, to: string, now = new Date()): Promise<InOutMatrix> {
  const { deptOk } = scopeParts(where);
  const emps = await listReportEmployees(where, from, to);
  const deptName = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const { summaries, planner } = await summarizeRange(emps.map((e) => e.id), from, to, now);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const holidays = new Map(dates.filter((d) => planner.holidays.has(d)).map((d) => [d, planner.holidayNames.get(d) ?? "Ngày lễ"]));
  const rows: InOutMatrix["rows"] = [];
  for (const e of emps) {
    const days: Record<string, { in: string; out: string }> = {};
    let count = 0;
    let lastDept: number | null | undefined = null;
    for (const d of dates) {
      const s = summaries.get(`${e.id}|${d}`);
      if (!s) continue;
      const dayDept = s.departmentId ?? e.departmentId;
      if (!deptOk(dayDept)) continue;
      count++;
      lastDept = dayDept;
      days[d] = { in: s.inTime ? vnTime(s.inTime) : "", out: s.outTime ? vnTime(s.outTime) : "" };
    }
    if (!count) continue;
    rows.push({ code: e.code, name: e.name, department: (lastDept != null && deptName.get(lastDept)) || e.department.name, jobTitle: e.jobTitle?.name ?? "", days });
  }
  return { from, to, dates, holidays, rows };
}

const FILL = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const FILL_HEAD = FILL("FFE2E8F0"); // xám nhạt
const FILL_SUN = FILL("FFF4B6B6"); // hồng: Chủ nhật
const FILL_HOLIDAY = FILL("FFFDE68A"); // vàng nhạt: ngày lễ
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
};
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };

/** Sheet "Giờ vào ra": 3 dòng tiêu đề (ngày / thứ / IN-OUT), mỗi nhân viên một dòng, cột Chủ nhật & ngày lễ tô màu. */
export async function inOutToXlsx(m: InOutMatrix): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Face Beo";
  const ws = wb.addWorksheet("Giờ vào ra");
  const HEAD_ROWS = 3;
  const FIXED = 4; // STT, Nhân viên, Bộ phận, Chức danh
  const lastCol = FIXED + m.dates.length * 2;
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 14;
  // Nhãn cột cố định đặt ở dòng 3 (không merge dọc) để bộ lọc/sắp xếp của Excel không vướng ô gộp.
  ["STT", "Nhân viên", "Bộ phận", "Chức danh"].forEach((t, i) => {
    const col = i + 1;
    for (let r = 1; r <= HEAD_ROWS; r++) {
      const c = ws.getCell(r, col);
      c.fill = FILL_HEAD;
      c.alignment = CENTER;
    }
    const c = ws.getCell(HEAD_ROWS, col);
    c.value = t;
    c.font = { bold: true };
  });
  const colFill = (d: string): ExcelJS.Fill | null => (weekday(d) === 7 ? FILL_SUN : m.holidays.has(d) ? FILL_HOLIDAY : null);
  m.dates.forEach((d, i) => {
    const col = FIXED + 1 + i * 2;
    ws.getColumn(col).width = 7.5;
    ws.getColumn(col + 1).width = 7.5;
    ws.mergeCells(1, col, 1, col + 1);
    ws.mergeCells(2, col, 2, col + 1);
    const c1 = ws.getCell(1, col);
    c1.value = fmtDay(d);
    c1.font = { size: 8, color: { argb: "FF64748B" } };
    const c2 = ws.getCell(2, col);
    c2.value = WEEKDAY_SHORT[weekday(d)];
    c2.font = { bold: true };
    const c3 = ws.getCell(3, col);
    c3.value = "IN";
    const c4 = ws.getCell(3, col + 1);
    c4.value = "OUT";
    c3.font = { bold: true, size: 9 };
    c4.font = { bold: true, size: 9 };
    const fill = colFill(d) ?? FILL_HEAD;
    for (const c of [c1, c2, c3, c4]) {
      c.alignment = CENTER;
      c.fill = fill;
    }
  });
  for (let r = 1; r <= HEAD_ROWS; r++) for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = THIN;

  m.rows.forEach((row, idx) => {
    const r = HEAD_ROWS + 1 + idx;
    ws.getCell(r, 1).value = idx + 1;
    ws.getCell(r, 2).value = row.name;
    ws.getCell(r, 3).value = row.department;
    ws.getCell(r, 4).value = row.jobTitle;
    ws.getCell(r, 1).alignment = CENTER;
    ws.getCell(r, 2).font = { bold: true, size: 10 };
    ws.getCell(r, 3).font = { size: 9 };
    ws.getCell(r, 4).font = { size: 9 };
    m.dates.forEach((d, i) => {
      const col = FIXED + 1 + i * 2;
      const v = row.days[d];
      const cin = ws.getCell(r, col);
      const cout = ws.getCell(r, col + 1);
      cin.value = v?.in || null;
      cout.value = v?.out || null;
      const fill = colFill(d);
      for (const c of [cin, cout]) {
        c.alignment = CENTER;
        c.font = { size: 10 };
        if (fill) c.fill = fill;
      }
    });
    for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = THIN;
  });
  ws.views = [{ state: "frozen", xSplit: FIXED, ySplit: HEAD_ROWS }];
  // Bộ lọc phủ toàn bộ cột để sắp xếp theo tên/bộ phận kéo theo cả giờ vào/ra.
  ws.autoFilter = { from: { row: HEAD_ROWS, column: 1 }, to: { row: HEAD_ROWS, column: lastCol } };

  const notes = [
    `Kỳ: ${fmtDay(m.from)} – ${fmtDay(m.to)} · ${m.rows.length} nhân viên`,
    "IN = lần quét đầu tiên, OUT = lần quét cuối cùng thuộc ca của ngày đó (ngày không có ca: mọi lần quét); ô trống = không có lần quét (nghỉ, chưa chấm hoặc chưa có lịch).",
    "Ngày chỉ có một lần quét: IN có, OUT trống (thiếu giờ ra). Giờ theo múi giờ Việt Nam, định dạng 24h.",
    "Cột hồng: Chủ nhật. Cột vàng: ngày lễ.",
    ...[...m.holidays].map(([d, n]) => `Ngày lễ ${fmtDay(d)}: ${n}`),
  ];
  addSheet(wb, "Ghi chú", notes.map((n) => ({ "Ghi chú": n })), [100], ["Ghi chú"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
