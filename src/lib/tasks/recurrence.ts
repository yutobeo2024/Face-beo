/**
 * Việc lặp — hàm thuần. Việc gốc (recurrence ≠ NONE, parentId null) sinh một bản lặp cho mỗi "ngày lặp" sau ngày hạn của
 * chính nó: bản lặp xuất hiện từ 00:00 ngày đó (giờ VN) — hoặc sớm hơn nếu có "Nhắc trước" — hạn = ngày đó lúc
 * `recurrenceTime` (trống = giờ hạn của việc gốc).
 *
 * KHÔNG bù quá `lookbackHours` (mặc định 24 giờ): server tắt một tuần thì bật lên chỉ sinh bản của hôm nay, không đổ
 * cả chục bản cũ lên bảng. Chạy lại không trùng nhờ unique (parentId, occurrenceDate) trong DB.
 */
import { DateTime } from "luxon";
import { addDays, TZ, vnDate, vnDateTime, vnDayRange, vnTime, weekday } from "../attendance";
import type { Recurrence } from "./types";

export type RecurringTask = { recurrence: Recurrence | string; recurrenceTime: string | null; dueAt: Date; startDate: string | null };

const day = (d: string) => DateTime.fromISO(d, { zone: TZ });

/** `date` có phải ngày lặp của việc có ngày hạn gốc `base` không (không xét ngày ≤ base). */
export function isOccurrence(recurrence: string, base: string, date: string): boolean {
  if (date <= base) return false;
  switch (recurrence) {
    case "DAILY":
      return true;
    case "WEEKLY":
      return weekday(date) === weekday(base);
    case "MONTHLY": {
      // Ngày 29–31 rơi vào tháng ngắn ⇒ kẹp về ngày cuối tháng (31/01 → 28/02 → 31/03).
      const d = day(date);
      return d.day === Math.min(day(base).day, d.daysInMonth!);
    }
    default:
      return false;
  }
}

/** Giờ hạn của bản lặp. */
export function occurrenceDueAt(task: Pick<RecurringTask, "recurrenceTime" | "dueAt">, date: string): Date {
  return vnDateTime(date, task.recurrenceTime || vnTime(task.dueAt));
}

/** Ngày bắt đầu của bản lặp: giữ đúng khoảng cách "bắt đầu → hạn" của việc gốc. */
export function shiftStartDate(task: Pick<RecurringTask, "startDate" | "dueAt">, date: string): string | null {
  if (!task.startDate || !day(task.startDate).isValid) return null; // ngày hỏng (vd. 30/02 nhập trước v1.23.0) ⇒ bỏ, không ném lỗi
  const gap = Math.round(day(vnDate(task.dueAt)).diff(day(task.startDate), "days").days);
  return addDays(date, -Math.max(0, gap));
}

/**
 * Các ngày lặp cần sinh lúc `now`. Mốc sinh của ngày `d` = 00:00 ngày `d`, hoặc sớm hơn đúng `leadHours` trước hạn
 * (việc có "Nhắc trước 1 tuần" phải có bản lặp từ trước đó 1 tuần thì nhắc mới kịp). Lấy các ngày có mốc sinh nằm trong
 * (now − lookback, now] và sau `lastOccurrence` (ngày đã sinh gần nhất — bản lặp bị xóa không sinh lại).
 */
export function dueOccurrences(task: RecurringTask & { lastOccurrence?: string | null }, now: Date, opts: { lookbackHours?: number; leadHours?: number } = {}): string[] {
  if (task.recurrence === "NONE") return [];
  const lookback = opts.lookbackHours ?? 24;
  const lead = opts.leadHours ?? 0;
  const base = vnDate(task.dueAt);
  const from = now.getTime() - lookback * 3600_000;
  const out: string[] = [];
  const last = vnDate(new Date(now.getTime() + (lead + 24) * 3600_000));
  for (let d = vnDate(new Date(from)); d <= last; d = addDays(d, 1)) {
    if (task.lastOccurrence && d <= task.lastOccurrence) continue;
    if (!isOccurrence(task.recurrence, base, d)) continue;
    const gen = Math.min(vnDayRange(d).start.getTime(), occurrenceDueAt(task, d).getTime() - lead * 3600_000);
    if (gen > from && gen <= now.getTime()) out.push(d);
  }
  return out;
}
