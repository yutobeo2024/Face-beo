/**
 * Nhập nhân viên hàng loạt từ Excel (v1.8.0).
 *  - File mẫu: sheet "Nhân viên" (danh sách thả xuống lấy từ sheet ẩn "DanhMuc"), sheet "Hướng dẫn".
 *  - Chỉ Mã NV + Họ tên bắt buộc. Mã đã có → CẬP NHẬT ô có điền (ô trống giữ nguyên); mã mới → TẠO MỚI với mặc định chọn khi nhập.
 *  - Xem trước (không ghi gì) → nhập thật: kiểm lại từ đầu, còn lỗi thì không nhập dòng nào (tất cả hoặc không).
 * Thông tin cá nhân (SĐT, CCCD, ngày sinh, giới tính, địa chỉ) không ghi giá trị vào nhật ký / tin Zalo.
 */
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { badRequest } from "./api";
import ExcelJS from "exceljs";
import { prisma } from "./db";
import type { AuthUser } from "./auth";
import { assertCanCreate, assertCanModify } from "./employee-guards";
import { can } from "./permissions";
import { ROLE_LABEL, type Role } from "./roles";
import { GENDER_LABEL, personalFields } from "./validators";
import { canSeePersonal, createEmployee, redactPersonal } from "./employees";
import { randomTempPassword } from "./temp-password";
import { applyScheduleChangeFromToday, ensureBaseline } from "./schedule-assignments";
import { todayVN } from "./attendance";

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const UNASSIGNED_DEPARTMENT = "Chưa phân phòng";
const TEMPLATE_ROWS = 500;

/** Cột của file mẫu (khóa nội bộ → tiêu đề). Đọc file theo TÊN cột, không theo vị trí. */
export const IMPORT_COLUMNS = [
  { key: "code", header: "Mã NV*", width: 11 },
  { key: "name", header: "Họ tên*", width: 26 },
  { key: "phone", header: "SĐT", width: 13 },
  { key: "nationalId", header: "CCCD", width: 15 },
  { key: "dateOfBirth", header: "Ngày sinh (dd/mm/yyyy)", width: 14 },
  { key: "gender", header: "Giới tính", width: 10 },
  { key: "address", header: "Địa chỉ", width: 34 },
  { key: "department", header: "Phòng ban", width: 22 },
  { key: "jobTitle", header: "Chức danh", width: 16 },
  { key: "specialty", header: "Chuyên khoa", width: 18 },
  { key: "role", header: "Vai trò", width: 12 },
  { key: "scheduleType", header: "Loại lịch", width: 11 },
  { key: "pattern", header: "Mẫu tuần", width: 20 },
  { key: "shift", header: "Ca mặc định", width: 16 },
] as const;
type ColKey = (typeof IMPORT_COLUMNS)[number]["key"];
type RawRow = { row: number; cells: Partial<Record<ColKey, string>> };

const SCHEDULE_LABEL = { FIXED: "Cố định", ROTATING: "Xoay ca" } as const;
const HEADER_ALIASES: Record<string, ColKey> = {
  "Mã nhân viên": "code",
  "Mã": "code",
  "Họ và tên": "name",
  "Tên": "name",
  "Số điện thoại": "phone",
  "Điện thoại": "phone",
  "Số CCCD": "nationalId",
  "Căn cước": "nationalId",
  "CMND": "nationalId",
  "Ngày sinh": "dateOfBirth",
  "Ngày tháng năm sinh": "dateOfBirth",
  "Bộ phận": "department",
  "Phòng": "department",
  "Chuyên môn": "specialty",
  "Ca": "shift",
};

/** SĐT: bỏ khoảng trắng / chấm / gạch; +84, 84 → 0; ô số Excel mất số 0 đầu → thêm lại. */
function normalizePhone(raw: string | undefined): { value?: string; fixed: boolean } {
  if (!raw) return { fixed: false };
  let v = raw.replace(/[\s.\-()]/g, "");
  if (/^\+?84\d{9,10}$/.test(v)) v = `0${v.replace(/^\+?84/, "")}`;
  // Chỉ 9 số (di động mất số 0 đầu) mới tự thêm 0; 10 số không có 0 đầu nhiều khả năng gõ sai → để báo lỗi.
  if (/^\d{9}$/.test(v)) return { value: `0${v}`, fixed: true };
  return { value: v, fixed: v !== raw };
}
/** CCCD: bỏ khoảng trắng; 11 số (ô số Excel mất số 0 đầu) → thêm lại. */
function normalizeNationalId(raw: string | undefined): { value?: string; fixed: boolean } {
  if (!raw) return { fixed: false };
  const v = raw.replace(/[\s.\-]/g, "");
  if (/^\d{11}$/.test(v)) return { value: `0${v}`, fixed: true };
  return { value: v, fixed: false };
}
const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
const headerKey = (h: string) => norm(h.replace(/\*/g, "").replace(/\(.*\)/g, ""));

async function catalogs() {
  const [departments, shifts, patterns, jobTitles, specialties] = await Promise.all([
    prisma.department.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.shift.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.workPattern.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.jobTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.specialty.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return { departments, shifts, patterns, jobTitles, specialties };
}

// ---------------------------------------------------------------------------
// File mẫu
// ---------------------------------------------------------------------------

export async function buildImportTemplate(actor: AuthUser): Promise<Buffer> {
  const c = await catalogs();
  const privileged = await can(actor, "roles.assignPrivileged");
  const roles = (privileged ? ["EMPLOYEE", "MANAGER", "HR", "ADMIN"] : ["EMPLOYEE", "MANAGER"]).map((r) => ROLE_LABEL[r as Role]);
  const lists: { title: string; items: string[] }[] = [
    { title: "Phòng ban", items: c.departments.map((d) => d.name) },
    { title: "Chức danh", items: c.jobTitles.map((d) => d.name) },
    { title: "Chuyên khoa", items: c.specialties.map((d) => d.name) },
    { title: "Mẫu tuần", items: c.patterns.map((d) => d.name) },
    { title: "Ca", items: c.shifts.map((d) => d.name) },
    { title: "Giới tính", items: Object.values(GENDER_LABEL) },
    { title: "Vai trò", items: roles },
    { title: "Loại lịch", items: Object.values(SCHEDULE_LABEL) },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = "Face Beo";
  const ws = wb.addWorksheet("Nhân viên", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((col) => ({ header: col.header, key: col.key, width: col.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((cell, i) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i <= 2 ? "FFFDE68A" : "FFE2E8F0" } };
  });
  // Mã NV, SĐT, CCCD giữ dạng chữ (không mất số 0 đầu); Ngày sinh dạng chữ để Excel máy tiếng Anh không đảo ngày/tháng.
  for (const k of ["code", "phone", "nationalId", "dateOfBirth"] as const) ws.getColumn(k).numFmt = "@";

  // Sheet danh mục (ẩn) làm nguồn cho danh sách thả xuống — tránh giới hạn 255 ký tự của danh sách viết thẳng.
  const dm = wb.addWorksheet("DanhMuc", { state: "hidden" });
  const range: Record<string, string> = {};
  lists.forEach((l, i) => {
    const col = i + 1;
    dm.getCell(1, col).value = l.title;
    l.items.forEach((v, r) => (dm.getCell(r + 2, col).value = v));
    const letter = dm.getColumn(col).letter;
    range[l.title] = `DanhMuc!$${letter}$2:$${letter}$${Math.max(2, l.items.length + 1)}`;
  });
  const listFor: Partial<Record<ColKey, string>> = {
    department: range["Phòng ban"],
    jobTitle: range["Chức danh"],
    specialty: range["Chuyên khoa"],
    pattern: range["Mẫu tuần"],
    shift: range["Ca"],
    gender: range["Giới tính"],
    role: range["Vai trò"],
    scheduleType: range["Loại lịch"],
  };
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    for (const [key, formula] of Object.entries(listFor)) {
      ws.getCell(r, ws.getColumn(key).number).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [formula!],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Không có trong danh sách",
        error: "Giá trị không có trong danh mục của Face Beo — hệ thống sẽ báo lỗi dòng này khi nhập.",
      };
    }
  }

  const guide = wb.addWorksheet("Hướng dẫn");
  guide.columns = [{ width: 24 }, { width: 110 }];
  const lines: [string, string][] = [
    ["Cột", "Cách điền"],
    ["Mã NV*", "Bắt buộc. Chữ, số, - và _ (2–20 ký tự). Mã đã có trong hệ thống → CẬP NHẬT ô có điền của người đó (ô trống giữ nguyên)."],
    ["Họ tên*", "Bắt buộc, 2–100 ký tự."],
    ["SĐT", "Không bắt buộc. 10–11 số, bắt đầu bằng 0. Không trùng người khác. Nhân viên đăng nhập bằng mã NV hoặc SĐT."],
    ["CCCD", "Không bắt buộc. 12 số (hoặc CMND 9 số), không trùng người khác. Chỉ Nhân sự, Quản trị và chính chủ xem được."],
    ["Ngày sinh", "Không bắt buộc. dd/mm/yyyy (vd. 05/03/1990) hoặc ô ngày của Excel. Tuổi 15–100."],
    ["Giới tính", "Nam / Nữ / Khác."],
    ["Địa chỉ", "Không bắt buộc, tối đa 300 ký tự."],
    ["Phòng ban", "Chọn trong danh sách. Để trống (người mới) → dùng phòng mặc định chọn trên màn hình nhập (thường là \"Chưa phân phòng\")."],
    ["Chức danh, Chuyên khoa", "Chọn trong danh sách (Cấu hình → Chức danh & chuyên khoa). Chỉ để mô tả, không ảnh hưởng quyền."],
    ["Vai trò", "Nhân viên / Quản lý (Nhân sự, Quản trị chỉ Quản trị nhập được). Để trống = Nhân viên. Chỉ áp cho người mới — đổi vai trò làm trong hồ sơ."],
    ["Loại lịch", "Cố định (theo mẫu tuần) / Xoay ca (xếp ca hằng tuần). Để trống = Cố định."],
    ["Mẫu tuần, Ca mặc định", "Chọn trong danh sách. Để trống (người mới) → dùng mặc định chọn trên màn hình nhập."],
    ["", ""],
    ["Ví dụ", "NV101 | Nguyễn Thị Lan | 0901234567 | 079190000123 | 05/03/1990 | Nữ | 12 Lê Lợi, Q1 | Điều dưỡng | Điều dưỡng | Nội | Nhân viên | Xoay ca | | Hành chính"],
    ["Lưu ý", "Đổi phòng / ca / mẫu tuần / loại lịch của người đã có chỉ có hiệu lực từ hôm nay (công các ngày đã qua giữ nguyên)."],
    ["", "Nhập xong, hệ thống cho tải file kết quả có MẬT KHẨU TẠM của người mới (chỉ hiện một lần). Lần đăng nhập đầu phải đổi mật khẩu."],
  ];
  lines.forEach(([a, b], i) => {
    const row = guide.getRow(i + 1);
    row.getCell(1).value = a;
    row.getCell(2).value = b;
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    if (i === 0) row.font = { bold: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Đọc file
// ---------------------------------------------------------------------------

/** Giá trị ô → chuỗi. Ô ngày của Excel → "YYYY-MM-DD". */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    return "";
  }
  return String(v);
}

export class ImportFileError extends Error {}

export async function readImportFile(buf: ArrayBuffer): Promise<RawRow[]> {
  if (buf.byteLength === 0) throw new ImportFileError("File rỗng");
  if (buf.byteLength > IMPORT_MAX_BYTES) throw new ImportFileError("File quá lớn (tối đa 2 MB)");
  const sig = new Uint8Array(buf, 0, 2);
  if (sig[0] !== 0x50 || sig[1] !== 0x4b) throw new ImportFileError("Không phải file Excel .xlsx (hãy dùng file mẫu tải từ Face Beo)");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new ImportFileError("Không đọc được file Excel");
  }
  const ws = wb.getWorksheet("Nhân viên") ?? wb.worksheets.find((w) => w.state !== "hidden" && w.name !== "Hướng dẫn");
  if (!ws) throw new ImportFileError("Không thấy sheet \"Nhân viên\"");
  const byHeader = new Map<string, ColKey>(IMPORT_COLUMNS.map((c) => [headerKey(c.header), c.key]));
  // Tên cột thường gặp trong file tự làm (không dùng file mẫu).
  for (const [alias, key] of Object.entries(HEADER_ALIASES)) byHeader.set(headerKey(alias), key);
  const colOf = new Map<number, ColKey>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = byHeader.get(headerKey(cellText(cell.value)));
    if (k) colOf.set(col, k);
  });
  const found = new Set(colOf.values());
  if (!found.has("code") || !found.has("name")) throw new ImportFileError("Thiếu cột \"Mã NV\" hoặc \"Họ tên\" ở dòng 1 (hãy dùng file mẫu)");
  if (ws.actualRowCount > IMPORT_MAX_ROWS + 1) throw new ImportFileError(`Quá ${IMPORT_MAX_ROWS} dòng — chia nhỏ file`);
  const rows: RawRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cells: Partial<Record<ColKey, string>> = {};
    for (const [col, key] of colOf) {
      const t = cellText(row.getCell(col).value).normalize("NFC").trim();
      if (t) cells[key] = t;
    }
    if (Object.keys(cells).length) rows.push({ row: n, cells });
  });
  if (rows.length > IMPORT_MAX_ROWS) throw new ImportFileError(`Quá ${IMPORT_MAX_ROWS} dòng — chia nhỏ file`);
  return rows;
}

// ---------------------------------------------------------------------------
// Kiểm tra từng dòng
// ---------------------------------------------------------------------------

export type ImportDefaults = { departmentId: number | "unassigned"; shiftId: number; patternId: number | null };

type Resolved = {
  code: string;
  name?: string;
  phone?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  departmentId?: number | "unassigned";
  jobTitleId?: number;
  specialtyId?: number;
  role?: string;
  scheduleType?: "FIXED" | "ROTATING";
  workPatternId?: number | null;
  defaultShiftId?: number;
};

export type ImportItem = {
  row: number;
  code: string;
  name: string;
  action: "CREATE" | "UPDATE" | "NOCHANGE" | "ERROR";
  errors: string[];
  warnings: string[];
  changes: string[];
  employeeId?: number;
  data?: Resolved;
};

const DOB_DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
function parseDob(s: string): string {
  const m = s.match(DOB_DMY);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) {
    // Số serial ngày của Excel (ô ngày bị định dạng số).
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

const FIELD_LABEL: Record<string, string> = {
  name: "họ tên",
  phone: "SĐT",
  nationalId: "CCCD",
  dateOfBirth: "ngày sinh",
  gender: "giới tính",
  address: "địa chỉ",
  departmentId: "phòng ban",
  jobTitleId: "chức danh",
  specialtyId: "chuyên khoa",
  scheduleType: "loại lịch",
  workPatternId: "mẫu tuần",
  defaultShiftId: "ca mặc định",
};

export async function planImport(rows: RawRow[], actor: AuthUser, defaults: ImportDefaults): Promise<ImportItem[]> {
  const c = await catalogs();
  const lookup = (list: { id: number; name: string }[]) => new Map(list.map((x) => [norm(x.name), x.id]));
  const deptBy = lookup(c.departments);
  const shiftBy = lookup(c.shifts);
  const patternBy = lookup(c.patterns);
  const titleBy = lookup(c.jobTitles);
  const specBy = lookup(c.specialties);
  const roleBy = new Map(Object.entries(ROLE_LABEL).map(([k, v]) => [norm(v), k]));
  const genderBy = new Map(Object.entries(GENDER_LABEL).map(([k, v]) => [norm(v), k]));
  genderBy.set("nu", "NU");
  const scheduleBy = new Map(Object.entries(SCHEDULE_LABEL).map(([k, v]) => [norm(v), k]));
  scheduleBy.set("co dinh", "FIXED");

  const codes = rows.map((r) => (r.cells.code ?? "").toUpperCase()).filter(Boolean);
  const existing = new Map(
    (
      await prisma.employee.findMany({
        where: { code: { in: codes } },
        select: {
          id: true,
          code: true,
          name: true,
          role: true,
          departmentId: true,
          phone: true,
          nationalId: true,
          dateOfBirth: true,
          gender: true,
          address: true,
          jobTitleId: true,
          specialtyId: true,
          scheduleType: true,
          workPatternId: true,
          defaultShiftId: true,
          active: true,
        },
      })
    ).map((e) => [e.code, e]),
  );
  // Chuẩn hóa SĐT / CCCD trước khi tra trùng với DB (kiểm trùng phải dùng đúng giá trị sẽ lưu).
  const norm2 = rows.map((r) => ({ phone: normalizePhone(r.cells.phone), nid: normalizeNationalId(r.cells.nationalId) }));
  const phones = norm2.map((x) => x.phone.value).filter((x): x is string => !!x);
  const ids = norm2.map((x) => x.nid.value).filter((x): x is string => !!x);
  const taken = await prisma.employee.findMany({
    where: { OR: [{ phone: { in: phones.length ? phones : ["-"] } }, { nationalId: { in: ids.length ? ids : ["-"] } }] },
    select: { code: true, phone: true, nationalId: true },
  });

  const seenCode = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenId = new Map<string, number>();
  const items: ImportItem[] = [];

  for (const [ri, r] of rows.entries()) {
    const x = r.cells;
    const errors: string[] = [];
    const warnings: string[] = [];
    const code = (x.code ?? "").toUpperCase();
    if (x.name) x.name = x.name.replace(/\s+/g, " ").trim(); // gộp tab / khoảng trắng thừa
    const item: ImportItem = { row: r.row, code, name: x.name ?? "", action: "ERROR", errors, warnings, changes: [] };
    items.push(item);

    if (!code) errors.push("thiếu Mã NV");
    else if (!/^[A-Z0-9_-]{2,20}$/.test(code)) errors.push("Mã NV chỉ gồm chữ, số, - và _ (2–20 ký tự)");
    else if (seenCode.has(code)) errors.push(`Mã NV trùng với dòng ${seenCode.get(code)}`);
    else seenCode.set(code, r.row);
    const target = code ? existing.get(code) : undefined;
    if (!target && !x.name) errors.push("thiếu Họ tên");
    if (x.name && (x.name.length < 2 || x.name.length > 100)) errors.push("Họ tên 2–100 ký tự");

    const d: Resolved = { code };
    if (x.name) d.name = x.name;

    // Thông tin cá nhân: kiểm bằng cùng luật với form (validators.personalFields).
    const phone = norm2[ri].phone.value;
    if (norm2[ri].phone.fixed) warnings.push(`SĐT "${x.phone}" — hiểu là ${phone}`);
    const nid = norm2[ri].nid.value;
    if (norm2[ri].nid.fixed) warnings.push(`CCCD 11 số — hiểu là ${nid} (Excel làm mất số 0 đầu)`);
    const personal: [keyof typeof personalFields, string | undefined][] = [
      ["phone", phone],
      ["nationalId", nid],
      ["dateOfBirth", x.dateOfBirth ? parseDob(x.dateOfBirth) : undefined],
      ["gender", x.gender ? (genderBy.get(norm(x.gender)) ?? x.gender) : undefined],
      ["address", x.address],
    ];
    const personalAllowed = canSeePersonal(actor);
    if (!personalAllowed && personal.some(([, v]) => v !== undefined)) warnings.push("bỏ qua SĐT / CCCD / ngày sinh / giới tính / địa chỉ — chỉ Nhân sự, Quản trị nhập được");
    for (const [k, v] of personal) {
      if (v === undefined || !personalAllowed) continue;
      const res = personalFields[k].safeParse(v);
      if (!res.success) errors.push(k === "gender" ? `giới tính "${x.gender}" không hợp lệ (Nam / Nữ / Khác)` : `${FIELD_LABEL[k]} "${x[k] ?? v}": ${res.error.issues[0]?.message ?? "không hợp lệ"}`);
      else (d as Record<string, unknown>)[k] = res.data;
    }
    if (d.phone) {
      if (seenPhone.has(d.phone)) errors.push(`SĐT trùng với dòng ${seenPhone.get(d.phone)}`);
      else seenPhone.set(d.phone, r.row);
      const other = taken.find((t) => t.phone === d.phone && t.code !== code);
      if (other) errors.push(`SĐT đã được dùng (${other.code})`);
    }
    if (d.nationalId) {
      if (seenId.has(d.nationalId)) errors.push(`CCCD trùng với dòng ${seenId.get(d.nationalId)}`);
      else seenId.set(d.nationalId, r.row);
      const other = taken.find((t) => t.nationalId === d.nationalId && t.code !== code);
      if (other) errors.push(`CCCD đã được dùng (${other.code})`);
    }

    // Danh mục: phải có sẵn (không tự tạo — tránh gõ sai chính tả thành phòng mới).
    const pick = (raw: string | undefined, map: Map<string, number>, label: string) => {
      if (!raw) return undefined;
      const id = map.get(norm(raw));
      if (id === undefined) errors.push(`${label} "${raw}" không có trong danh mục`);
      return id;
    };
    const deptId = pick(x.department, deptBy, "phòng ban");
    const titleId = pick(x.jobTitle, titleBy, "chức danh");
    const specId = pick(x.specialty, specBy, "chuyên khoa");
    const patternId = pick(x.pattern, patternBy, "mẫu tuần");
    const shiftId = pick(x.shift, shiftBy, "ca");
    let role: string | undefined;
    if (x.role) {
      role = roleBy.get(norm(x.role));
      if (!role) errors.push(`vai trò "${x.role}" không hợp lệ (Nhân viên / Quản lý / Nhân sự / Quản trị)`);
    }
    let scheduleType: "FIXED" | "ROTATING" | undefined;
    if (x.scheduleType) {
      scheduleType = scheduleBy.get(norm(x.scheduleType)) as typeof scheduleType;
      if (!scheduleType) errors.push(`loại lịch "${x.scheduleType}" không hợp lệ (Cố định / Xoay ca)`);
    }
    if (titleId !== undefined) d.jobTitleId = titleId;
    if (specId !== undefined) d.specialtyId = specId;
    if (errors.length) continue;

    if (!target) {
      // TẠO MỚI: ô trống dùng mặc định chọn trên màn hình nhập.
      d.departmentId = deptId ?? defaults.departmentId;
      d.defaultShiftId = shiftId ?? defaults.shiftId;
      d.role = role ?? "EMPLOYEE";
      d.scheduleType = scheduleType ?? "FIXED";
      d.workPatternId = d.scheduleType === "FIXED" ? (patternId ?? defaults.patternId) : null;
      if (d.scheduleType === "ROTATING" && patternId) warnings.push("xoay ca không dùng mẫu tuần — bỏ qua cột Mẫu tuần");
      if (d.departmentId === "unassigned" && actor.role === "MANAGER") {
        errors.push("Quản lý phải điền Phòng ban (phòng mình quản lý)");
        continue;
      }
      try {
        await assertCanCreate(actor, { role: d.role, departmentId: d.departmentId === "unassigned" ? actor.departmentId : d.departmentId });
        if (d.departmentId === "unassigned" && !["ADMIN", "HR"].includes(actor.role)) throw new Error("Không có quyền dùng phòng \"Chưa phân phòng\"");
      } catch (e) {
        errors.push((e as Error).message);
        continue;
      }
      item.action = "CREATE";
      item.data = d;
      continue;
    }

    // CẬP NHẬT: chỉ ô có điền, ghi đè; ô trống giữ nguyên.
    item.employeeId = target.id;
    if (role && role !== target.role) warnings.push("không đổi vai trò khi nhập Excel — đổi trong hồ sơ nhân viên");
    if (deptId !== undefined) d.departmentId = deptId;
    if (shiftId !== undefined) d.defaultShiftId = shiftId;
    if (scheduleType) d.scheduleType = scheduleType;
    if (patternId !== undefined) {
      if ((scheduleType ?? target.scheduleType) === "ROTATING") warnings.push("xoay ca không dùng mẫu tuần — bỏ qua cột Mẫu tuần");
      else d.workPatternId = patternId;
    }
    if (scheduleType === "ROTATING") d.workPatternId = null;
    try {
      await assertCanModify(actor, target, { departmentId: typeof d.departmentId === "number" ? d.departmentId : undefined });
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    item.name = target.name; // chỉ hiện tên người đã có sau khi qua kiểm phạm vi
    if (!target.active) warnings.push("nhân viên đã nghỉ việc — vẫn cập nhật hồ sơ");
    // Chỉ giữ trường thật sự khác giá trị hiện tại (tránh ghi lại lịch / tính lại công khi không đổi gì).
    for (const k of Object.keys(d) as (keyof Resolved)[]) {
      if (k === "code") continue;
      if ((target as Record<string, unknown>)[k] === d[k]) delete d[k];
      else item.changes.push(FIELD_LABEL[k] ?? k);
    }
    item.action = item.changes.length ? "UPDATE" : "NOCHANGE";
    if (item.changes.length) item.data = d;
  }
  return items;
}

export function summarize(items: ImportItem[]) {
  return {
    total: items.length,
    create: items.filter((i) => i.action === "CREATE").length,
    update: items.filter((i) => i.action === "UPDATE").length,
    unchanged: items.filter((i) => i.action === "NOCHANGE").length,
    errors: items.filter((i) => i.action === "ERROR").length,
  };
}

// ---------------------------------------------------------------------------
// Nhập thật
// ---------------------------------------------------------------------------

const SCHEDULE_KEYS = ["departmentId", "scheduleType", "workPatternId", "defaultShiftId"] as const;

export async function commitImport(items: ImportItem[], actor: AuthUser) {
  const creates = items.filter((i) => i.action === "CREATE");
  const updates = items.filter((i) => i.action === "UPDATE");
  // Băm mật khẩu TRƯỚC giao dịch (bcrypt chậm) để giữ khóa ghi SQLite ngắn, và TỪNG CÁI MỘT: băm song song hàng trăm mật khẩu
  // chiếm hết vòng lặp sự kiện → cả server (kể cả kiosk quét mặt) đứng hình hàng chục giây.
  const secrets: { temp: string; hash: string }[] = [];
  for (let i = 0; i < creates.length; i++) {
    const temp = randomTempPassword();
    secrets.push({ temp, hash: await bcrypt.hash(temp, 10) });
    await new Promise((r) => setImmediate(r)); // nhường lượt cho request khác giữa các lần băm
  }
  const scheduleChanged = updates.filter((u) => SCHEDULE_KEYS.some((k) => u.data && k in u.data)).map((u) => u.employeeId!);
  await ensureBaseline(scheduleChanged);

  const result = await prisma.$transaction(
    async (tx) => {
      let unassignedId: number | null = null;
      const unassigned = async () => {
        if (unassignedId) return unassignedId;
        const d = (await tx.department.findUnique({ where: { name: UNASSIGNED_DEPARTMENT } })) ?? (await tx.department.create({ data: { name: UNASSIGNED_DEPARTMENT } }));
        unassignedId = d.id;
        return d.id;
      };
      const out: { code: string; name: string; department: string; result: string; tempPassword: string }[] = [];
      for (const [i, it] of creates.entries()) {
        const d = it.data!;
        const departmentId = d.departmentId === "unassigned" ? await unassigned() : d.departmentId!;
        const { employee } = await createEmployee(
          {
            code: d.code,
            name: d.name!,
            role: d.role!,
            departmentId,
            defaultShiftId: d.defaultShiftId!,
            scheduleType: d.scheduleType,
            workPatternId: d.workPatternId,
            jobTitleId: d.jobTitleId,
            specialtyId: d.specialtyId,
            phone: d.phone,
            nationalId: d.nationalId,
            dateOfBirth: d.dateOfBirth,
            gender: d.gender,
            address: d.address,
          },
          actor.id,
          tx,
          { via: "import", passwordHash: secrets[i].hash },
        );
        out.push({ code: employee.code, name: employee.name, department: "", result: "Tạo mới", tempPassword: secrets[i].temp });
      }
      for (const it of updates) {
        const { departmentId, ...rest } = it.data!;
        const data: Record<string, unknown> = { ...rest };
        delete data.code; // mã là khóa tra cứu, không đổi
        if (departmentId !== undefined) data.departmentId = departmentId === "unassigned" ? await unassigned() : departmentId;
        const before = await tx.employee.findUniqueOrThrow({ where: { id: it.employeeId! }, select: { departmentId: true } });
        await tx.employee.update({ where: { id: it.employeeId! }, data });
        if (data.departmentId !== undefined && data.departmentId !== before.departmentId) {
          // Như sửa tay: lịch tương lai do phòng cũ xếp không "ăn theo" phòng mới.
          const dropped = await tx.workSchedule.deleteMany({ where: { employeeId: it.employeeId!, date: { gt: todayVN() } } });
          if (dropped.count) {
            await tx.auditLog.create({
              data: { actorId: actor.id, action: "ROSTER_CHANGE", entity: "Employee", entityId: String(it.employeeId), detail: JSON.stringify({ reason: "department-change", via: "import", droppedFutureCells: dropped.count }) },
            });
          }
        }
        await tx.auditLog.create({
          data: { actorId: actor.id, action: "EMPLOYEE_UPDATE", entity: "Employee", entityId: String(it.employeeId), detail: JSON.stringify({ via: "import", ...redactPersonal(data) }) },
        });
        out.push({ code: it.code, name: (data.name as string) ?? it.name, department: "", result: `Cập nhật: ${it.changes.join(", ")}`, tempPassword: "" });
      }
      return out;
    },
    { timeout: 60_000 },
  ).catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw badRequest("Trùng mã / SĐT / CCCD với dữ liệu vừa thay đổi — kiểm tra lại file rồi nhập lại (chưa nhập dòng nào)");
    throw e;
  });
  if (scheduleChanged.length) await applyScheduleChangeFromToday(scheduleChanged);

  // Tên phòng cho file kết quả.
  const emps = await prisma.employee.findMany({ where: { code: { in: result.map((r) => r.code) } }, select: { code: true, department: { select: { name: true } } } });
  const deptOf = new Map(emps.map((e) => [e.code, e.department.name]));
  for (const r of result) r.department = deptOf.get(r.code) ?? "";
  return { rows: result, created: creates.length, updated: updates.length };
}

/** File kết quả: mật khẩu tạm của người mới — chỉ đưa ra MỘT LẦN (không lưu ở đâu khác). */
export async function buildResultFile(rows: { code: string; name: string; department: string; result: string; tempPassword: string }[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Face Beo";
  const ws = wb.addWorksheet("Kết quả nhập");
  ws.columns = [
    { header: "Mã NV", key: "code", width: 11 },
    { header: "Họ tên", key: "name", width: 26 },
    { header: "Phòng ban", key: "department", width: 22 },
    { header: "Kết quả", key: "result", width: 40 },
    { header: "Mật khẩu tạm", key: "tempPassword", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.addRow({});
  ws.addRow({ code: "Lưu ý", name: "Mật khẩu tạm chỉ có trong file này — phát riêng cho từng người; lần đăng nhập đầu phải đổi mật khẩu." });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
