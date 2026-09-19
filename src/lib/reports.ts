/** Bảng công tổng hợp + chi tiết, xuất Excel phía server (PRD mục 5). */
import * as XLSX from "xlsx";
import { prisma } from "./db";
import { summarizeRange } from "./attendance-service";
import { vnDayRange, vnTime, type DayStatus } from "./attendance";
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

export async function buildAttendanceReport(where: object, from: string, to: string, now = new Date()) {
  const emps = await prisma.employee.findMany({
    where: { ...where, active: true },
    select: { id: true, code: true, name: true, department: { select: { name: true } } },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
  });
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
    for (const [k, s] of summaries) {
      if (!k.startsWith(`${e.id}|`)) continue;
      row.workDays = r2(row.workDays + s.workDayUnits);
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
      row.leaveDays = r2(row.leaveDays + s.leaveDayUnits);
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
        department: e.department.name,
        date: s.workDate,
        shift: s.shift ? `${s.shift.name} ${s.shift.startTime}–${s.shift.endTime}` : "",
        inTime: s.inTime ? vnTime(s.inTime) : "",
        outTime: s.outTime ? vnTime(s.outTime) : "",
        lateMinutes: s.lateMinutes,
        earlyMinutes: s.earlyMinutes,
        otMinutes: s.otMinutes,
        workDayUnits: s.workDayUnits,
        workMinutes: s.workMinutes,
        status: STATUS_LABEL[s.status],
        note: notes.join("; "),
      });
    }
    summary.push(row);
  }
  return { summary, detail };
}

export function reportToXlsx(r: { summary: SummaryRow[]; detail: DetailRow[] }): Buffer {
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(
    r.summary.map((x) => ({
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
      "Ngày công": x.workDays,
      "Giờ công": r2(x.workMinutes / 60),
      "Số lần trễ": x.lateCount,
      "Tổng phút trễ": x.lateMinutes,
      "Số lần về sớm": x.earlyCount,
      "Tổng phút về sớm": x.earlyMinutes,
      "Giờ OT": Math.round((x.otMinutes / 60) * 100) / 100,
      "Ngày nghỉ phép": x.leaveDays,
      "Ngày vắng không phép": x.absentDays,
      "Số ngày thiếu giờ ra": x.missingOutDays,
      "Số lần bổ sung công": x.correctionCount,
    })),
  );
  s1["!cols"] = [8, 24, 22, 10, 9, 10, 13, 13, 16, 8, 14, 18, 18, 18].map((w) => ({ wch: w }));
  const s2 = XLSX.utils.json_to_sheet(
    r.detail.map((x) => ({
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
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
  );
  s2["!cols"] = [8, 24, 22, 11, 26, 8, 8, 9, 9, 9, 6, 9, 16, 50].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, s1, "Tổng hợp");
  XLSX.utils.book_append_sheet(wb, s2, "Chi tiết");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
