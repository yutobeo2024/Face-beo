/**
 * Hàm thuần tính ngày cho Lịch / Gantt (v1.24.0) — file .ts (không JSX) để test nạp thẳng được.
 * Chỉ dùng src/lib/client/format.ts (giờ VN cố định), không luxon.
 */
import { addDaysStr, addMonthsStr, fmtTime, mondayOf, vnDateOf } from "../client/format";
import type { TaskDto } from "./types";

export type CalMode = "month" | "week" | "day";
export type DragMode = "move" | "start" | "end";
export type GanttChange = { startDate?: string; dueAt?: string };

/** Khoảng ngày cần tải cho một chế độ xem quanh ngày `anchor`. */
export function calendarRange(mode: CalMode, anchor: string): { from: string; to: string } {
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") {
    const mon = mondayOf(anchor);
    return { from: mon, to: addDaysStr(mon, 6) };
  }
  const start = mondayOf(`${anchor.slice(0, 7)}-01`);
  return { from: start, to: addDaysStr(start, 41) };
}

/** Bước tiến / lùi của nút ‹ ›. */
export function shiftAnchor(mode: CalMode, anchor: string, dir: 1 | -1) {
  if (mode === "day") return addDaysStr(anchor, dir);
  if (mode === "week") return addDaysStr(anchor, 7 * dir);
  return `${addMonthsStr(anchor.slice(0, 7), dir)}-01`;
}

/** Hạn mới: ngày mới + giờ:phút của hạn cũ (giờ VN). */
export const dueOnDay = (dueAt: string, day: string) => new Date(`${day}T${fmtTime(dueAt)}:00+07:00`).toISOString();

/** Thay đổi gửi lên khi thả một lần kéo — chỉ gửi trường thật sự đổi (kéo mép trái không đụng tới hạn). */
export function dragChange(t: Pick<TaskDto, "startDate" | "dueAt">, mode: DragMode, delta: number): GanttChange | null {
  if (!delta || !t.startDate) return null;
  const s0 = t.startDate;
  const e0 = vnDateOf(t.dueAt);
  let s = mode === "end" ? s0 : addDaysStr(s0, delta);
  let e = mode === "start" ? e0 : addDaysStr(e0, delta);
  if (s > e) {
    if (mode === "start") s = e;
    else e = s;
  }
  const out: GanttChange = {};
  if (s !== s0) out.startDate = s;
  if (e !== e0) out.dueAt = dueOnDay(t.dueAt, e);
  return Object.keys(out).length ? out : null;
}
