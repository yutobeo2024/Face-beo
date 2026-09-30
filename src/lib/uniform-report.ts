/**
 * Báo cáo đồng phục (v1.20.0) — file Excel RIÊNG, không trộn vào bảng công.
 *
 * Lý do tách: kết luận đồng phục có thể được Nhân sự sửa sau, còn bảng công tháng đã chốt thì bất biến. Trộn chung
 * sẽ làm bảng công "đổi số" sau khi chốt. File này chỉ đọc bảng `UniformCheck`, không đụng `LockedDay`/`PayrollLock`.
 *
 * Ba sheet: Tổng hợp (mỗi người một dòng) · Chi tiết (mỗi ngày một dòng) · Ghi chú (cách đọc + ngưỡng đang dùng).
 */
import ExcelJS from "exceljs";
import { prisma } from "./db";
import { vnTime } from "./attendance";
import { addSheet } from "./reports";
import { getSettings } from "./settings";
import { UNIFORM_MODEL_VERSION } from "./uniform-embed";
import { UNIFORM_REASON_LABEL, UNIFORM_STATUS_LABEL, type UniformReason } from "./uniform-score";


const MODE_LABEL: Record<string, string> = { ON: "Kiểm thật", SHADOW: "Chạy thử" };

const statusLabel = (v: string) => UNIFORM_STATUS_LABEL[v as keyof typeof UNIFORM_STATUS_LABEL] ?? v;

/** Phần trăm làm tròn 1 chữ số. */
const pct1 = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);
const sc = (v: number | null) => (v == null ? "" : Math.round(v * 100));

export type UniformSummaryRow = {
  code: string;
  name: string;
  department: string;
  checked: number;
  pass: number;
  fail: number;
  review: number;
  skipped: number;
  decided: number;
};

export type UniformDetailRow = {
  date: string;
  code: string;
  name: string;
  department: string;
  shift: string;
  inTime: string;
  status: string;
  machineStatus: string;
  template: string;
  score: number | null;
  colorScore: number | null;
  embedScore: number | null;
  reason: string;
  decidedBy: string;
  note: string;
  mode: string;
};

export type UniformReport = { from: string; to: string; summary: UniformSummaryRow[]; detail: UniformDetailRow[] };

/**
 * Gom dữ liệu trong khoảng ngày cho những nhân viên thuộc phạm vi `where` (đã ghép quyền + phòng ở route).
 * `mode` lọc theo chế độ: bỏ trống là lấy cả bản chạy thử lẫn bản kiểm thật.
 */
export async function buildUniformReport(where: object, from: string, to: string, mode?: "ON" | "SHADOW"): Promise<UniformReport> {
  const emps = await prisma.employee.findMany({
    where,
    select: { id: true, code: true, name: true, department: { select: { name: true } } },
    orderBy: [{ department: { name: "asc" } }, { code: "asc" }],
  });
  const byId = new Map(emps.map((e) => [e.id, e]));

  const checks = await prisma.uniformCheck.findMany({
    where: { employeeId: { in: [...byId.keys()] }, workDate: { gte: from, lte: to }, ...(mode ? { mode } : {}) },
    orderBy: [{ workDate: "asc" }, { checkTime: "asc" }],
  });

  const shifts = new Map((await prisma.shift.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const templates = new Map(
    (await prisma.uniformTemplate.findMany({ where: { id: { in: uniq(checks.map((c) => c.templateId)) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]),
  );
  const deciders = new Map(
    (await prisma.employee.findMany({ where: { id: { in: uniq(checks.map((c) => c.decidedById)) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
  );

  const acc = new Map<number, UniformSummaryRow>();
  const detail: UniformDetailRow[] = [];

  for (const c of checks) {
    const e = byId.get(c.employeeId);
    if (!e) continue;
    const row =
      acc.get(c.employeeId) ??
      { code: e.code, name: e.name, department: e.department.name, checked: 0, pass: 0, fail: 0, review: 0, skipped: 0, decided: 0 };
    if (c.status === "SKIPPED") row.skipped++;
    else {
      row.checked++;
      if (c.status === "PASS") row.pass++;
      else if (c.status === "FAIL") row.fail++;
      else row.review++;
    }
    if (c.decidedById) row.decided++;
    acc.set(c.employeeId, row);

    detail.push({
      date: c.workDate,
      code: e.code,
      name: e.name,
      department: e.department.name,
      shift: (c.shiftId != null && shifts.get(c.shiftId)) || "",
      inTime: vnTime(c.checkTime),
      status: statusLabel(c.status),
      machineStatus: statusLabel(c.machineStatus),
      template: (c.templateId != null && templates.get(c.templateId)) || "",
      score: c.score,
      colorScore: c.colorScore,
      embedScore: c.embedScore,
      reason: c.reason ? (UNIFORM_REASON_LABEL[c.reason as UniformReason] ?? c.reason) : "",
      decidedBy: (c.decidedById != null && deciders.get(c.decidedById)) || "",
      note: c.note ?? "",
      mode: MODE_LABEL[c.mode] ?? c.mode,
    });
  }

  // Giữ thứ tự phòng → mã nhân viên như danh sách gốc.
  const summary = emps.map((e) => acc.get(e.id)).filter((r): r is UniformSummaryRow => !!r);
  return { from, to, summary, detail };
}

function uniq(list: (number | null)[]): number[] {
  return [...new Set(list.filter((v): v is number => v != null))];
}

const SUMMARY_HEADERS = ["Mã NV", "Họ tên", "Phòng ban", "Số ngày kiểm", "Đạt", "Không đạt", "Cần xem lại", "Tỉ lệ đạt (%)", "Bỏ qua", "Do người xác nhận"];
const DETAIL_HEADERS = [
  "Ngày",
  "Mã NV",
  "Họ tên",
  "Phòng ban",
  "Ca",
  "Giờ vào",
  "Kết luận",
  "Máy kết luận",
  "Mẫu áo khớp",
  "Điểm chung",
  "Điểm màu",
  "Điểm hình dáng",
  "Lý do",
  "Người xác nhận",
  "Ghi chú",
  "Chế độ",
];

/** Dựng file Excel. `notes` là các dòng nhắc thêm (ví dụ phòng nào đang chạy thử). */
export async function uniformToXlsx(r: UniformReport, notes: string[] = []): Promise<Buffer> {
  const s = await getSettings();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Face Beo";

  const ws1 = addSheet(
    wb,
    "Tổng hợp",
    r.summary.map((x) => ({
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
      "Số ngày kiểm": x.checked,
      "Đạt": x.pass,
      "Không đạt": x.fail,
      "Cần xem lại": x.review,
      "Tỉ lệ đạt (%)": pct1(x.pass, x.checked),
      "Bỏ qua": x.skipped,
      "Do người xác nhận": x.decided,
    })),
    [8, 24, 22, 13, 8, 11, 13, 14, 9, 17],
    SUMMARY_HEADERS,
  );

  const ws2 = addSheet(
    wb,
    "Chi tiết",
    r.detail.map((x) => ({
      "Ngày": x.date.split("-").reverse().join("/"),
      "Mã NV": x.code,
      "Họ tên": x.name,
      "Phòng ban": x.department,
      "Ca": x.shift,
      "Giờ vào": x.inTime,
      "Kết luận": x.status,
      "Máy kết luận": x.machineStatus,
      "Mẫu áo khớp": x.template,
      "Điểm chung": sc(x.score),
      "Điểm màu": sc(x.colorScore),
      "Điểm hình dáng": sc(x.embedScore),
      "Lý do": x.reason,
      "Người xác nhận": x.decidedBy,
      "Ghi chú": x.note,
      "Chế độ": x.mode,
    })),
    [11, 8, 24, 22, 20, 9, 13, 13, 20, 11, 10, 14, 44, 20, 30, 11],
    DETAIL_HEADERS,
  );

  // Đóng băng dòng tiêu đề + bật lọc để mở ra là lọc được ngay.
  for (const ws of [ws1, ws2]) {
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  }

  addSheet(
    wb,
    "Ghi chú",
    [
      ...notes.map((n) => ({ "Ghi chú": n })),
      { "Ghi chú": `Kỳ báo cáo: ${r.from.split("-").reverse().join("/")} — ${r.to.split("-").reverse().join("/")}.` },
      { "Ghi chú": "Chỉ kiểm lượt chấm VÀO đầu ca, mỗi người một lần mỗi ngày. Người không thuộc diện chấm công không bị kiểm." },
      { "Ghi chú": "Đạt = áo khớp một trong các mẫu của phòng. Không đạt = không khớp mẫu nào." },
      { "Ghi chú": "Cần xem lại = máy chưa chắc (ảnh tối, thiếu vùng áo, mẫu áo còn ít ảnh…) — PHẢI để Nhân sự xem ảnh rồi quyết, không được coi là vi phạm." },
      { "Ghi chú": "Bỏ qua = phòng chưa khai mẫu áo hoặc chưa bật kiểm." },
      { "Ghi chú": "Cột “Máy kết luận” là kết luận gốc của máy, luôn giữ nguyên kể cả khi người đã xác nhận khác đi." },
      { "Ghi chú": "Bản ghi ở chế độ “Chạy thử” chỉ để đo ngưỡng — KHÔNG dùng để xử lý nhân sự." },
      { "Ghi chú": "Điểm tính theo thang 100. Ngưỡng đang dùng: đạt màu ≥ " + Math.round(s.uniformPassColor * 100) + ", đạt hình dáng ≥ " + Math.round(s.uniformPassEmbed * 100) + ", dưới " + Math.round(s.uniformFailScore * 100) + " là không đạt." },
      { "Ghi chú": `Trọng số màu trong điểm chung: ${Math.round(s.uniformColorWeight * 100)}%. Phiên bản mô hình: ${UNIFORM_MODEL_VERSION}.` },
      { "Ghi chú": "File này độc lập với bảng công — sửa kết luận đồng phục không làm đổi số liệu chấm công." },
    ],
    [110],
    ["Ghi chú"],
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
