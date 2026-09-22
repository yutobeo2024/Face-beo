/**
 * Hồ sơ hành nghề (v1.9.0): Giấy phép hành nghề (GPHN), văn bằng, chứng chỉ, CME.
 * Quy định CME (Thông tư 32/2023/TT-BYT): ≥ 48 tiết trong 2 năm liên tiếp; ≥ 120 tiết trong mỗi chu kỳ 5 năm để gia hạn GPHN,
 * tiết của chu kỳ trước không cộng sang chu kỳ sau. Ngưỡng cấu hình được (AppSetting cmeTwoYearHours / cmeCycleHours / cmeCycleYears).
 * Phần tính toán là hàm thuần (không đụng DB) để kiểm thử dễ.
 */
import { z } from "zod";
import { DateTime } from "luxon";

export const LICENSE_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED", "UNKNOWN"] as const;
export const LICENSE_STATUS_LABEL: Record<(typeof LICENSE_STATUSES)[number], string> = {
  ACTIVE: "Hoạt động",
  SUSPENDED: "Đình chỉ",
  REVOKED: "Thu hồi / không còn hoạt động",
  UNKNOWN: "Chưa rõ",
};
export const LICENSE_SUBJECTS = ["Bác sĩ", "Y sĩ", "Điều dưỡng", "Hộ sinh", "Kỹ thuật y", "Dược sĩ", "Khác"] as const;

export const CREDENTIAL_TYPES = ["DEGREE", "SPECIALTY", "CME", "CDNN", "RADIATION", "LANG_IT", "TEACHING", "OTHER"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export const CREDENTIAL_TYPE_LABEL: Record<CredentialType, string> = {
  DEGREE: "Văn bằng",
  SPECIALTY: "Chứng chỉ chuyên môn / định hướng",
  CME: "CME (đào tạo liên tục)",
  CDNN: "Chức danh nghề nghiệp",
  RADIATION: "An toàn bức xạ",
  LANG_IT: "Ngoại ngữ – tin học",
  TEACHING: "Sư phạm y học",
  OTHER: "Khác",
};

/** Trang tra cứu công khai người hành nghề (đợt sau: tự tra cứu định kỳ). */
export const MEDINET_URL = "https://tracuu.medinet.org.vn/";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "định dạng YYYY-MM-DD").refine((s) => DateTime.fromISO(s).isValid, "ngày không tồn tại");
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess(blankToNull, ymd.nullable().optional());
// Số tiết: chỉ nhận số hoặc chuỗi số (không để true/[] bị ép thành số).
const hours = z.preprocess(
  (v) => (v === "" || v == null ? null : typeof v === "number" || typeof v === "string" ? v : Number.NaN),
  z.coerce.number().positive("số tiết phải > 0").max(1000).nullable().optional(),
);
const todayVNStr = () => DateTime.now().setZone("Asia/Ho_Chi_Minh").toISODate()!;
/** Ngày cấp không ở tương lai; hạn dùng không trước ngày cấp. Dùng chung cho tạo mới và giá trị sau khi gộp PATCH. */
export function dateOrderError(issuedAt: string | null | undefined, expiresAt: string | null | undefined): string | null {
  if (issuedAt && issuedAt > todayVNStr()) return "ngày cấp không được ở tương lai";
  if (issuedAt && expiresAt && expiresAt < issuedAt) return "hạn dùng phải sau ngày cấp";
  return null;
}

/** GPHN: có số giấy phép thì bắt buộc đủ ngày cấp, nơi cấp, đối tượng, phạm vi chuyên môn, tình trạng. */
export const licenseSchema = z.object({
  number: z.string().trim().min(3, "nhập số GPHN").max(60),
  issuedAt: ymd,
  issuer: z.string().trim().min(2, "nhập nơi cấp").max(120),
  subject: z.string().trim().min(2, "nhập đối tượng cấp").max(60),
  scope: z.string().trim().min(3, "nhập phạm vi chuyên môn").max(500),
  status: z.enum(LICENSE_STATUSES),
  expiresAt: optDate,
  renewedAt: optDate,
  cmeCycleStart: optDate,
  workplaceNote: optText(300),
})
  .superRefine((l, ctx) => {
    const err = dateOrderError(l.issuedAt, l.expiresAt);
    if (err) ctx.addIssue({ code: "custom", message: err, path: ["expiresAt"] });
    if (l.renewedAt && l.renewedAt < l.issuedAt) ctx.addIssue({ code: "custom", message: "ngày gia hạn phải sau ngày cấp", path: ["renewedAt"] });
  });
export type LicenseInput = z.infer<typeof licenseSchema>;

export const credentialSchema = z
  .object({
    type: z.enum(CREDENTIAL_TYPES),
    name: z.string().trim().min(2, "nhập tên văn bằng / chứng chỉ").max(200),
    issuer: optText(200),
    number: optText(80),
    issuedAt: optDate,
    expiresAt: optDate,
    cmeHours: hours,
  })
  .refine((c) => c.type !== "CME" || (c.cmeHours != null && c.issuedAt != null), { message: "CME cần số tiết và ngày cấp", path: ["cmeHours"] })
  .superRefine((c, ctx) => {
    const err = dateOrderError(c.issuedAt, c.expiresAt);
    if (err) ctx.addIssue({ code: "custom", message: err, path: ["issuedAt"] });
  });
// PATCH: không .default() — trường không gửi giữ nguyên (luật zod 4 của dự án).
export const credentialPatchSchema = z.object({
  type: z.enum(CREDENTIAL_TYPES).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  issuer: optText(200),
  number: optText(80),
  issuedAt: optDate,
  expiresAt: optDate,
  cmeHours: hours,
});

export type CmeSettings = { cmeTwoYearHours: number; cmeCycleHours: number; cmeCycleYears: number; credentialWarnDays: number };
type Cme = { issuedAt: string | null; cmeHours: number | null };

const d = (s: string) => DateTime.fromISO(s, { zone: "utc" });
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Tính CME: 24 tháng gần nhất và chu kỳ hiện tại [mốc + k×N năm, + N năm). Chứng chỉ không có ngày cấp bị bỏ qua. */
export function cmeStatus(cycleStart: string | null, cmes: Cme[], s: CmeSettings, today: string) {
  const t = d(today);
  const twoYearFrom = t.minus({ years: 2 }).toISODate()!;
  const valid = cmes.filter((c): c is { issuedAt: string; cmeHours: number } => !!c.issuedAt && c.cmeHours != null && c.issuedAt <= today);
  const twoYearHours = round1(valid.filter((c) => c.issuedAt > twoYearFrom).reduce((a, c) => a + c.cmeHours, 0));
  let cycle: { from: string; to: string; hours: number; daysLeft: number } | null = null;
  if (cycleStart) {
    const base = d(cycleStart);
    // Chu kỳ đang chứa "hôm nay" (mốc trong tương lai → chu kỳ đầu). Tính từ mốc gốc (base + k×N năm) để mốc 29/02 không bị trôi.
    let k = 0;
    while (base.plus({ years: (k + 1) * s.cmeCycleYears }) <= t) k++;
    const from = base.plus({ years: k * s.cmeCycleYears });
    const to = base.plus({ years: (k + 1) * s.cmeCycleYears });
    const fromS = from.toISODate()!;
    const toS = to.toISODate()!;
    const hours = round1(valid.filter((c) => c.issuedAt >= fromS && c.issuedAt < toS).reduce((a, c) => a + c.cmeHours, 0));
    cycle = { from: fromS, to: toS, hours, daysLeft: Math.max(0, Math.round(to.diff(t, "days").days)) };
  }
  return { twoYearFrom, twoYearHours, twoYearRequired: s.cmeTwoYearHours, cycle, cycleRequired: s.cmeCycleHours };
}

export type LicenseIssue = { kind: string; severity: "danger" | "warn"; text: string };

/**
 * Các vấn đề hồ sơ hành nghề của một nhân viên. `requiresLicense` = chức danh bắt buộc GPHN.
 * CME chỉ xét khi người đó có GPHN (người không hành nghề không bị đòi CME).
 */
export function licenseIssues(args: {
  requiresLicense: boolean;
  license: { status: string; issuedAt: string; expiresAt: string | null; cmeCycleStart: string; verifiedAt: Date | null; medinetResult?: string | null } | null;
  credentials: { id: number; type: string; name: string; issuedAt: string | null; expiresAt: string | null; cmeHours: number | null }[];
  settings: CmeSettings;
  today: string;
}): LicenseIssue[] {
  const { license, settings: s, today } = args;
  const out: LicenseIssue[] = [];
  const warnUntil = d(today).plus({ days: s.credentialWarnDays }).toISODate()!;
  const fmt = (x: string) => x.split("-").reverse().join("/");
  if (!license) {
    if (args.requiresLicense) out.push({ kind: "license-missing", severity: "danger", text: "Chưa nhập Giấy phép hành nghề (chức danh bắt buộc GPHN)" });
  } else {
    if (license.status !== "ACTIVE") {
      out.push({ kind: `license-status-${license.status}`, severity: "danger", text: `GPHN tình trạng: ${LICENSE_STATUS_LABEL[license.status as keyof typeof LICENSE_STATUS_LABEL] ?? license.status}` });
    }
    if (license.expiresAt && license.expiresAt < today) out.push({ kind: "license-expired", severity: "danger", text: `GPHN đã hết hạn ngày ${fmt(license.expiresAt)}` });
    else if (license.expiresAt && license.expiresAt <= warnUntil) out.push({ kind: "license-expiring", severity: "warn", text: `GPHN hết hạn ngày ${fmt(license.expiresAt)} — chuẩn bị gia hạn` });
    const cme = cmeStatus(
      license.cmeCycleStart,
      args.credentials.filter((c) => c.type === "CME"),
      s,
      today,
    );
    // Mới được cấp GPHN chưa đủ 2 năm thì chưa xét mốc 48 tiết / 2 năm.
    if (license.issuedAt <= cme.twoYearFrom && cme.twoYearHours < s.cmeTwoYearHours) {
      out.push({ kind: "cme-2y", severity: cme.twoYearHours === 0 ? "danger" : "warn", text: `CME 2 năm gần nhất: ${cme.twoYearHours}/${s.cmeTwoYearHours} tiết` });
    }
    if (cme.cycle && cme.cycle.hours < s.cmeCycleHours && cme.cycle.daysLeft <= s.credentialWarnDays * 2) {
      out.push({
        kind: "cme-cycle",
        severity: "warn",
        text: `CME chu kỳ ${fmt(cme.cycle.from)}–${fmt(cme.cycle.to)}: ${cme.cycle.hours}/${s.cmeCycleHours} tiết, còn ${cme.cycle.daysLeft} ngày`,
      });
    }
    out.push(...medinetIssues(license.medinetResult));
    if (!license.verifiedAt || d(today).diff(DateTime.fromJSDate(license.verifiedAt), "months").months > 12) {
      out.push({ kind: "license-unverified", severity: "warn", text: "Chưa đối chiếu GPHN trên medinet trong 12 tháng" });
    }
  }
  for (const c of args.credentials) {
    if (!c.expiresAt || c.type === "CME") continue;
    if (c.expiresAt < today) out.push({ kind: `cred-expired-${c.id}`, severity: "warn", text: `${c.name} đã hết hạn ngày ${fmt(c.expiresAt)}` });
    else if (c.expiresAt <= warnUntil) out.push({ kind: `cred-expiring-${c.id}`, severity: "warn", text: `${c.name} hết hạn ngày ${fmt(c.expiresAt)}` });
  }
  return out;
}

const FIELD_LABEL: Record<string, string> = { name: "họ tên", issuedAt: "ngày cấp", issuer: "nơi cấp", subject: "đối tượng", scope: "phạm vi chuyên môn", status: "tình trạng" };
type StoredMedinet = {
  found?: boolean;
  ambiguous?: boolean;
  record?: { name: string; statusText: string | null; status: string };
  diffs?: { field: string; local: string | null; remote: string | null; severity: "danger" | "warn" }[];
  elsewhere?: { facility: string; facilityLicense: string | null; schedule: string | null }[];
  atClinic?: boolean | null;
};

/** Vấn đề rút ra từ lần tra medinet gần nhất (v1.11.0). Lần tra lỗi (mạng / đổi giao diện) giữ kết quả cũ, không tạo cảnh báo sai. */
export function medinetIssues(raw: string | null | undefined): LicenseIssue[] {
  if (!raw) return [];
  let r: StoredMedinet;
  try {
    r = JSON.parse(raw);
  } catch {
    return [];
  }
  if (r.found === false && r.ambiguous) return [{ kind: "medinet-ambiguous", severity: "warn", text: "medinet có nhiều hồ sơ cùng số GPHN, không phân định được — tra tay" }];
  if (r.found === false) return [{ kind: "medinet-notfound", severity: "warn", text: "Không tìm thấy số GPHN trên medinet (TP.HCM) — kiểm tra lại số hoặc tra tay" }];
  if (!r.found || !r.record) return [];
  const out: LicenseIssue[] = [];
  const diffs = r.diffs ?? [];
  const status = diffs.find((x) => x.field === "status");
  if (status && r.record.status !== "ACTIVE") out.push({ kind: `medinet-status-${r.record.status}`, severity: "danger", text: `medinet ghi GPHN tình trạng: ${r.record.statusText ?? r.record.status}` });
  const name = diffs.find((x) => x.field === "name");
  if (name) out.push({ kind: "medinet-name", severity: "danger", text: `Tên trên medinet "${name.remote}" khác hồ sơ "${name.local}"` });
  const other = diffs.filter((x) => x.field !== "name" && !(x.field === "status" && r.record!.status !== "ACTIVE"));
  // kind gắn danh sách mục khác → khác thêm mục mới trong tháng vẫn được báo (dedupe theo kind).
  if (other.length) out.push({ kind: `medinet-diff-${other.map((x) => x.field).sort().join("+")}`, severity: "warn", text: `Hồ sơ khác medinet: ${other.map((x) => FIELD_LABEL[x.field] ?? x.field).join(", ")}` });
  if (r.atClinic === false) out.push({ kind: "medinet-not-at-clinic", severity: "warn", text: "medinet chưa ghi nơi công tác tại phòng khám" });
  if (r.elsewhere?.length) {
    // Tin nhóm Zalo chỉ nêu SỐ nơi — tên cơ sở khác và giờ làm xem trong hồ sơ (chỉ Nhân sự / Quản trị / chính chủ).
    const key = r.elsewhere.map((w) => (w.facilityLicense ?? w.facility).split("/")[0]).sort().join("+");
    out.push({ kind: `medinet-elsewhere-${key}`, severity: "warn", text: `medinet ghi đang đăng ký hành nghề thêm ${r.elsewhere.length} nơi khác — xem Hồ sơ hành nghề` });
  }
  return out;
}
