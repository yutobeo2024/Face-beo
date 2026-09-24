/**
 * Định dạng ngày giờ cho phía trình duyệt (v1.16.0 — bỏ luxon, nhẹ 21 KB nén trên mọi trang).
 * Việt Nam dùng UTC+7 cố định từ 1975, không có giờ mùa hè → cộng/trừ 7 giờ là đúng, không cần thư viện múi giờ.
 * Các hàm nhận chuỗi "YYYY-MM-DD" tính bằng UTC nên không bị lệch ngày theo múi giờ của máy người dùng.
 */
export const TZ = "Asia/Ho_Chi_Minh";
const OFFSET_MS = 7 * 3600_000;

export const WEEKDAY_SHORT = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const WEEKDAY_LONG = ["", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];

const p2 = (n: number) => String(n).padStart(2, "0");
/** Mốc thời gian → các thành phần ngày giờ THEO GIỜ VIỆT NAM (đọc bằng getUTC* sau khi dịch +7). */
const vn = (iso: string | Date) => new Date((typeof iso === "string" ? new Date(iso) : iso).getTime() + OFFSET_MS);
/** "YYYY-MM-DD" → Date lúc 00:00 UTC của chính ngày đó (chỉ để cộng trừ ngày / lấy thứ). */
const dayUTC = (date: string) => new Date(`${date}T00:00:00.000Z`);
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;

export const fmtTime = (iso: string | Date) => {
  const d = vn(iso);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
export const fmtDateTime = (iso: string | Date) => {
  const d = vn(iso);
  return `${fmtTime(iso)} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
export const fmtDay = (date: string) => date.split("-").reverse().join("/");
export const fmtDayShort = (date: string) => {
  const d = dayUTC(date);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`;
};
/** Thứ theo kiểu ISO: 1 = thứ Hai … 7 = Chủ nhật (khớp WEEKDAY_SHORT / WEEKDAY_LONG). */
export const weekdayOf = (date: string) => ((dayUTC(date).getUTCDay() + 6) % 7) + 1;
export const todayStr = () => isoDay(vn(new Date()));
export const addDaysStr = (date: string, n: number) => isoDay(new Date(dayUTC(date).getTime() + n * 86_400_000));
/** "YYYY-MM" cộng/trừ n tháng (dùng cho nút chuyển tháng). */
export const addMonthsStr = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
};
export const mondayOf = (date: string) => addDaysStr(date, -(weekdayOf(date) - 1));

/** "YYYY-MM-DDTHH:mm" giờ VN cho ô nhập datetime-local <-> ISO UTC. */
export const toLocalInput = (iso: string) => {
  const d = vn(iso);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
export const fromLocalInput = (v: string) => {
  // Ô trống / giá trị hỏng: trả chuỗi rỗng để máy chủ báo lỗi bằng tiếng Việt (trước đây luxon cũng trả rỗng).
  const d = new Date(`${v.slice(0, 16)}:00+07:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

export function fmtMinutes(m: number) {
  if (!m) return "0";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}p`;
  return r ? `${h}g${String(r).padStart(2, "0")}` : `${h}g`;
}

const REL: [number, Intl.RelativeTimeFormatUnit][] = [
  [86_400_000, "day"],
  [3_600_000, "hour"],
  [60_000, "minute"],
  [1_000, "second"],
];
/** "3 giờ trước", "trong 2 ngày nữa"… (Intl có sẵn trong trình duyệt, không cần thư viện). */
export function relTime(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  for (const [ms, unit] of REL) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "second");
}
