import { DateTime } from "luxon";

export const TZ = "Asia/Ho_Chi_Minh";

export const WEEKDAY_SHORT = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const WEEKDAY_LONG = ["", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];

export const dt = (iso: string | Date) =>
  (typeof iso === "string" ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(TZ);

export const fmtDateTime = (iso: string | Date) => dt(iso).toFormat("HH:mm dd/MM/yyyy");
export const fmtTime = (iso: string | Date) => dt(iso).toFormat("HH:mm");
export const fmtDay = (date: string) => date.split("-").reverse().join("/");
export const fmtDayShort = (date: string) => DateTime.fromISO(date, { zone: TZ }).toFormat("dd/MM");
export const weekdayOf = (date: string) => DateTime.fromISO(date, { zone: TZ }).weekday;
export const todayStr = () => DateTime.now().setZone(TZ).toISODate()!;
export const addDaysStr = (date: string, n: number) => DateTime.fromISO(date, { zone: TZ }).plus({ days: n }).toISODate()!;
export const mondayOf = (date: string) => DateTime.fromISO(date, { zone: TZ }).startOf("week").toISODate()!;

/** "YYYY-MM-DDTHH:mm" giờ VN cho input datetime-local <-> ISO UTC. */
export const toLocalInput = (iso: string) => dt(iso).toFormat("yyyy-LL-dd'T'HH:mm");
export const fromLocalInput = (v: string) => DateTime.fromISO(v, { zone: TZ }).toUTC().toISO()!;

export function fmtMinutes(m: number) {
  if (!m) return "0";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}p`;
  return r ? `${h}g${String(r).padStart(2, "0")}` : `${h}g`;
}

export function relTime(iso: string) {
  return dt(iso).setLocale("vi").toRelative() ?? "";
}
