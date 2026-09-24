// Kiểu dùng chung cho các mục của trang Cấu hình (v1.15.0 — tách 1 file 1045 dòng thành các mục theo tab).
export type RunFn = (fn: () => Promise<unknown>, ok: string, after?: () => void) => Promise<void>;
export type ConfirmBox = { title: string; body: string; ok: string; fn: () => Promise<unknown>; after: () => void };
export type ConfirmFn = (box: ConfirmBox) => void;
/** Mọi mục nhận cùng bộ công cụ: cờ đang bận, hàm chạy có toast, và hộp xác nhận xóa dùng chung của trang. */
export type SectionProps = { busy: boolean; run: RunFn; confirm: ConfirmFn };

export type Shift = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  breakStart: string | null;
  workDayValue: number;
};
export type Weight = { departmentId: number; shiftId: number; workDayValue: number };
export type Holiday = { date: string; name: string };
export const DAY_KEYS = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const;
export const DAY_LABEL = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export type Pattern = { id?: number; name: string; employeeCount?: number } & Record<(typeof DAY_KEYS)[number], number | null>;

/** Toàn bộ cấu hình số của hệ thống. Mỗi thẻ chỉ PUT các khóa của chính nó (xem numberFields) — không ghi đè phần thẻ khác vừa lưu. */
export type Settings = {
  matchThreshold: number;
  matchMargin: number;
  livenessThreshold: number;
  livenessServerThreshold: number;
  absentAfterMinutes: number;
  snapshotRetentionDays: number;
  otRoundMinutes: number;
  cmeTwoYearHours: number;
  cmeCycleHours: number;
  cmeCycleYears: number;
  credentialWarnDays: number;
};
export type SettingsField = { key: keyof Settings; label: string; hint: string; step: number };
export type SystemInfo = {
  zaloSimulated: boolean;
  livenessServer: boolean;
  l2: { modelPath: string; modelExists: boolean; error: string | null };
  faceModelVersion: string;
  face: { label: string; modelPath: string; modelExists: boolean; error: string | null };
};

export function fmtDateTimeSafe(iso: string) {
  try {
    return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return iso;
  }
}
