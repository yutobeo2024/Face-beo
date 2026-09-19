/**
 * Logic chấm công thuần (PRD mục 4). KHÔNG truy cập DB, KHÔNG phụ thuộc múi giờ máy chủ.
 * Mọi mốc thời gian vào/ra là `Date` (UTC); ngày công và giờ ca hiểu theo Asia/Ho_Chi_Minh.
 */
import { DateTime } from "luxon";

export const TZ = "Asia/Ho_Chi_Minh";
export const WINDOW_BEFORE_MIN = 120;
export const WINDOW_AFTER_MIN = 240;
export const DUPLICATE_SCAN_SECONDS = 120;

const MIN = 60_000;

export type ShiftDef = {
  id: number;
  name: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"; <= startTime => qua đêm
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
};

export type ScheduleEntry = { shiftId: number | null; isDayOff: boolean };

export type DayPlan = {
  workDate: string;
  shift: ShiftDef | null;
  isDayOff: boolean;
  isHoliday: boolean;
  source: "SCHEDULE" | "DEFAULT";
};

export type RequestType = "NGHI_PHEP" | "VE_SOM" | "TANG_CA_OT";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type RequestLite = {
  id: number;
  type: RequestType | string;
  status: RequestStatus | string;
  fromTime: Date;
  toTime: Date;
};

export type LogLite = {
  id?: number;
  checkTime: Date;
  type: "IN" | "OUT" | string;
  shiftId?: number | null;
  workDate?: string;
  source?: string;
};

export type AttendanceSettings = {
  absentAfterMinutes: number;
  otRoundMinutes: number;
};

export const DEFAULT_SETTINGS: AttendanceSettings = { absentAfterMinutes: 30, otRoundMinutes: 15 };

// ---------------------------------------------------------------------------
// Thời gian
// ---------------------------------------------------------------------------

export function toVN(d: Date): DateTime {
  return DateTime.fromJSDate(d, { zone: TZ });
}

/** Ngày "YYYY-MM-DD" theo giờ VN của một mốc UTC. */
export function vnDate(d: Date): string {
  return toVN(d).toISODate()!;
}

export function vnTime(d: Date): string {
  return toVN(d).toFormat("HH:mm");
}

export function todayVN(now: Date = new Date()): string {
  return vnDate(now);
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date, { zone: TZ }).plus({ days: n }).toISODate()!;
}

/** Thứ trong tuần theo ISO: 1 = Thứ Hai … 7 = Chủ nhật. */
export function weekday(date: string): number {
  return DateTime.fromISO(date, { zone: TZ }).weekday;
}

/** Thứ Hai của tuần chứa `date`. */
export function startOfWeek(date: string): string {
  return DateTime.fromISO(date, { zone: TZ }).startOf("week").toISODate()!;
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Mốc UTC của "YYYY-MM-DD HH:mm" giờ VN. */
export function vnDateTime(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return DateTime.fromISO(date, { zone: TZ }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}

/** Khoảng đầu–cuối của cả ngày VN, dạng UTC [start, end). */
export function vnDayRange(date: string): { start: Date; end: Date } {
  const s = DateTime.fromISO(date, { zone: TZ }).startOf("day");
  return { start: s.toJSDate(), end: s.plus({ days: 1 }).toJSDate() };
}

export function isOvernight(shift: Pick<ShiftDef, "startTime" | "endTime">): boolean {
  return shift.endTime <= shift.startTime;
}

export function shiftInterval(workDate: string, shift: ShiftDef): { start: Date; end: Date } {
  const start = vnDateTime(workDate, shift.startTime);
  const endDate = isOvernight(shift) ? addDays(workDate, 1) : workDate;
  return { start, end: vnDateTime(endDate, shift.endTime) };
}

export function shiftWindow(workDate: string, shift: ShiftDef): { start: Date; end: Date } {
  const { start, end } = shiftInterval(workDate, shift);
  return {
    start: new Date(start.getTime() - WINDOW_BEFORE_MIN * MIN),
    end: new Date(end.getTime() + WINDOW_AFTER_MIN * MIN),
  };
}

export function shiftLengthMinutes(shift: ShiftDef): number {
  const i = shiftInterval("2026-01-05", shift);
  return Math.round((i.end.getTime() - i.start.getTime()) / MIN);
}

function diffMinutes(a: Date, b: Date): number {
  // Số phút trọn vẹn a − b (làm tròn xuống, bỏ giây lẻ).
  return Math.floor((a.getTime() - b.getTime()) / MIN);
}

// ---------------------------------------------------------------------------
// Xác định ca của một ngày
// ---------------------------------------------------------------------------

export function resolveDayPlan(args: {
  date: string;
  schedule?: ScheduleEntry | null;
  defaultShift: ShiftDef | null;
  shiftsById: Map<number, ShiftDef>;
  holidays: Set<string>;
}): DayPlan {
  const { date, schedule, defaultShift, shiftsById, holidays } = args;
  const isHoliday = holidays.has(date);
  if (schedule) {
    if (schedule.isDayOff || schedule.shiftId == null) {
      return { workDate: date, shift: null, isDayOff: true, isHoliday, source: "SCHEDULE" };
    }
    const shift = shiftsById.get(schedule.shiftId) ?? null;
    return { workDate: date, shift, isDayOff: shift == null, isHoliday, source: "SCHEDULE" };
  }
  if (weekday(date) === 7 || isHoliday || !defaultShift) {
    return { workDate: date, shift: null, isDayOff: true, isHoliday, source: "DEFAULT" };
  }
  return { workDate: date, shift: defaultShift, isDayOff: false, isHoliday, source: "DEFAULT" };
}

// ---------------------------------------------------------------------------
// Gán lần quét vào ca
// ---------------------------------------------------------------------------

export type ScanAssignment = {
  workDate: string;
  plan: DayPlan | null; // null => ngoài ca
  outOfShift: boolean;
};

/**
 * Xét ca hôm qua / hôm nay / ngày mai (theo giờ VN của lần quét); chọn ca có cửa sổ chứa giờ quét.
 * Chồng cửa sổ => ca có mốc bắt đầu hoặc kết thúc gần giờ quét nhất.
 */
export function assignScan(scanTime: Date, planFor: (date: string) => DayPlan): ScanAssignment {
  const today = vnDate(scanTime);
  const t = scanTime.getTime();
  let best: { plan: DayPlan; dist: number } | null = null;
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) {
    const plan = planFor(d);
    if (!plan.shift) continue;
    const w = shiftWindow(d, plan.shift);
    if (t < w.start.getTime() || t > w.end.getTime()) continue;
    const iv = shiftInterval(d, plan.shift);
    const dist = Math.min(Math.abs(t - iv.start.getTime()), Math.abs(t - iv.end.getTime()));
    if (!best || dist < best.dist) best = { plan, dist };
  }
  if (!best) return { workDate: today, plan: null, outOfShift: true };
  return { workDate: best.plan.workDate, plan: best.plan, outOfShift: false };
}

/** Quét lại trong 120 giây => trùng. Trả về log trước đó nếu trùng. */
export function findDuplicateScan<T extends LogLite>(scanTime: Date, previousLogs: T[]): T | null {
  let hit: T | null = null;
  for (const l of previousLogs) {
    const dt = Math.abs(scanTime.getTime() - l.checkTime.getTime());
    if (dt < DUPLICATE_SCAN_SECONDS * 1000 && (!hit || l.checkTime > hit.checkTime)) hit = l;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Giờ hiệu lực theo đơn đã duyệt
// ---------------------------------------------------------------------------

export type EffectiveTimes = {
  start: Date;
  end: Date;
  startExcusedBy: number | null;
  endExcusedBy: number | null;
  fullLeaveRequestId: number | null;
};

function approved(reqs: RequestLite[], ...types: string[]) {
  return reqs.filter((r) => r.status === "APPROVED" && types.includes(r.type));
}

type Block = { from: number; to: number; firstId: number; lastId: number };

/** Gộp các khoảng đơn chồng hoặc nối tiếp nhau (vd. nghỉ 08–12 và 12–17 => một khối 08–17). */
function mergeBlocks(reqs: RequestLite[]): Block[] {
  const sorted = reqs
    .map((r) => ({ from: r.fromTime.getTime(), to: r.toTime.getTime(), id: r.id }))
    .sort((x, y) => x.from - y.from || x.to - y.to);
  const out: Block[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      if (r.to > last.to) {
        last.to = r.to;
        last.lastId = r.id;
      }
    } else out.push({ from: r.from, to: r.to, firstId: r.id, lastId: r.id });
  }
  return out;
}

export function effectiveTimes(workDate: string, shift: ShiftDef, requests: RequestLite[]): EffectiveTimes {
  const iv = shiftInterval(workDate, shift);
  const s = iv.start.getTime();
  const e = iv.end.getTime();
  let start = s;
  let end = e;
  let startExcusedBy: number | null = null;
  let endExcusedBy: number | null = null;
  let fullLeaveRequestId: number | null = null;

  for (const b of mergeBlocks(approved(requests, "NGHI_PHEP"))) {
    if (b.from <= s && b.to >= e) {
      fullLeaveRequestId = b.firstId;
    } else if (b.from <= s && b.to > s) {
      // Phủ đầu ca: dời giờ bắt đầu hiệu lực tới cuối khối nghỉ.
      start = b.to;
      startExcusedBy = b.lastId;
    }
  }
  if (fullLeaveRequestId == null) {
    for (const b of mergeBlocks(approved(requests, "VE_SOM", "NGHI_PHEP"))) {
      // Phủ cuối ca: lùi giờ kết thúc hiệu lực về đầu khối.
      if (b.from > s && b.from < e && b.to >= e) {
        end = b.from;
        endExcusedBy = b.firstId;
      }
    }
  }
  if (end < start) end = start;
  return { start: new Date(start), end: new Date(end), startExcusedBy, endExcusedBy, fullLeaveRequestId };
}

// ---------------------------------------------------------------------------
// Tính kết quả cho các log của một ngày công
// ---------------------------------------------------------------------------

export type LogResult = {
  type: "IN" | "OUT";
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  excusedByRequestId: number | null;
};

export function computeLate(inTime: Date, eff: EffectiveTimes, shift: ShiftDef, rawStart: Date) {
  const lateMinutes = Math.max(0, diffMinutes(inTime, eff.start));
  const isLate = lateMinutes > shift.graceLateMinutes;
  const rawLate = Math.max(0, diffMinutes(inTime, rawStart));
  return { lateMinutes, isLate, excusedBy: eff.startExcusedBy != null && rawLate > lateMinutes ? eff.startExcusedBy : null };
}

export function computeEarly(outTime: Date, eff: EffectiveTimes, shift: ShiftDef, rawEnd: Date) {
  const earlyMinutes = Math.max(0, diffMinutes(eff.end, outTime));
  const isEarly = earlyMinutes > shift.graceEarlyMinutes;
  const rawEarly = Math.max(0, diffMinutes(rawEnd, outTime));
  return { earlyMinutes, isEarly, excusedBy: eff.endExcusedBy != null && rawEarly > earlyMinutes ? eff.endExcusedBy : null };
}

/**
 * Tính lại toàn bộ log của một (nhân viên, ngày công, ca): log sớm nhất là IN, còn lại OUT.
 * Trả về kết quả theo đúng thứ tự thời gian.
 */
export function computeDayLogs(plan: DayPlan, logs: LogLite[], requests: RequestLite[]): LogResult[] {
  const sorted = [...logs].sort((a, b) => a.checkTime.getTime() - b.checkTime.getTime());
  if (!plan.shift) {
    return sorted.map((_, i) => ({
      type: i === 0 ? "IN" : "OUT",
      isLate: false,
      lateMinutes: 0,
      isEarly: false,
      earlyMinutes: 0,
      excusedByRequestId: null,
    }));
  }
  const shift = plan.shift;
  const iv = shiftInterval(plan.workDate, shift);
  const eff = effectiveTimes(plan.workDate, shift, requests);
  return sorted.map((l, i) => {
    if (i === 0) {
      const late = computeLate(l.checkTime, eff, shift, iv.start);
      return {
        type: "IN" as const,
        isLate: late.isLate,
        lateMinutes: late.lateMinutes,
        isEarly: false,
        earlyMinutes: 0,
        excusedByRequestId: late.excusedBy,
      };
    }
    const early = computeEarly(l.checkTime, eff, shift, iv.end);
    return {
      type: "OUT" as const,
      isLate: false,
      lateMinutes: 0,
      isEarly: early.isEarly,
      earlyMinutes: early.earlyMinutes,
      excusedByRequestId: early.excusedBy,
    };
  });
}

// ---------------------------------------------------------------------------
// Giờ công và OT
// ---------------------------------------------------------------------------

// Theo PRD mục 4: luôn trừ đủ breakMinutes. Quyết định còn mở D1 (docs/OPEN-DECISIONS.md):
// có thể đổi sang chỉ trừ phần giờ nghỉ giao với khoảng có mặt.
export function workMinutes(shift: ShiftDef, inTime: Date, outTime: Date): number {
  const raw = diffMinutes(outTime, inTime) - shift.breakMinutes;
  const cap = shiftLengthMinutes(shift) - shift.breakMinutes;
  return Math.max(0, Math.min(raw, cap));
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** OT = giao giữa đơn TANG_CA_OT đã duyệt và thời gian có mặt ngoài ca, làm tròn xuống theo otRoundMinutes. */
export function otMinutes(args: {
  workDate: string;
  shift: ShiftDef;
  inTime: Date;
  outTime: Date;
  requests: RequestLite[];
  otRoundMinutes: number;
}): { minutes: number; requestIds: number[] } {
  const { workDate, shift, inTime, outTime, requests, otRoundMinutes } = args;
  const iv = shiftInterval(workDate, shift);
  const p0 = inTime.getTime();
  const p1 = outTime.getTime();
  const s = iv.start.getTime();
  const e = iv.end.getTime();
  // Khoảng có mặt ngoài ca: [p0, min(p1, s)] và [max(p0, e), p1]
  const outside: [number, number][] = [];
  if (p0 < s) outside.push([p0, Math.min(p1, s)]);
  if (p1 > e) outside.push([Math.max(p0, e), p1]);
  let ms = 0;
  const ids: number[] = [];
  for (const r of approved(requests, "TANG_CA_OT")) {
    let got = 0;
    for (const [o0, o1] of outside) got += overlap(o0, o1, r.fromTime.getTime(), r.toTime.getTime());
    if (got > 0) ids.push(r.id);
    ms += got;
  }
  const total = Math.floor(ms / MIN);
  const round = Math.max(1, otRoundMinutes);
  return { minutes: Math.floor(total / round) * round, requestIds: ids };
}

// ---------------------------------------------------------------------------
// Tổng hợp một ngày
// ---------------------------------------------------------------------------

export type DayStatus =
  | "DAY_OFF" // nghỉ theo lịch / Chủ nhật
  | "HOLIDAY" // ngày lễ, không đi làm
  | "ON_LEAVE" // nghỉ có phép cả ca
  | "NOT_YET" // chưa đến ca / chưa quá ngưỡng vắng
  | "ABSENT" // vắng mặt không phép
  | "ON_TIME"
  | "LATE"
  | "OUT_OF_SHIFT"; // có log nhưng không có ca

export type DaySummary = {
  workDate: string;
  shift: ShiftDef | null;
  status: DayStatus;
  inTime: Date | null;
  outTime: Date | null;
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  workMinutes: number;
  otMinutes: number;
  missingOut: boolean;
  holidayWork: boolean;
  pendingLeave: boolean;
  relatedRequestIds: number[];
  hasManual: boolean;
};

/** Đơn phủ một mốc thời gian (from <= t < to). */
export function requestCovers(r: RequestLite, t: Date): boolean {
  return r.fromTime.getTime() <= t.getTime() && r.toTime.getTime() > t.getTime();
}

export function summarizeDay(args: {
  plan: DayPlan;
  logs: LogLite[];
  requests: RequestLite[];
  now: Date;
  settings?: AttendanceSettings;
}): DaySummary {
  const { plan, requests, now } = args;
  const settings = args.settings ?? DEFAULT_SETTINGS;
  const logs = [...args.logs].sort((a, b) => a.checkTime.getTime() - b.checkTime.getTime());
  const base: DaySummary = {
    workDate: plan.workDate,
    shift: plan.shift,
    status: "DAY_OFF",
    inTime: logs[0]?.checkTime ?? null,
    outTime: logs.length > 1 ? logs[logs.length - 1].checkTime : null,
    isLate: false,
    lateMinutes: 0,
    isEarly: false,
    earlyMinutes: 0,
    workMinutes: 0,
    otMinutes: 0,
    missingOut: false,
    holidayWork: plan.isHoliday && logs.length > 0,
    pendingLeave: false,
    relatedRequestIds: [],
    hasManual: logs.some((l) => l.source === "MANUAL"),
  };

  if (!plan.shift) {
    base.status = logs.length > 0 ? "OUT_OF_SHIFT" : plan.isHoliday ? "HOLIDAY" : "DAY_OFF";
    return base;
  }
  const shift = plan.shift;
  const iv = shiftInterval(plan.workDate, shift);
  const win = shiftWindow(plan.workDate, shift);
  const eff = effectiveTimes(plan.workDate, shift, requests);
  const related = new Set<number>();

  base.pendingLeave = requests.some(
    (r) =>
      r.status === "PENDING" &&
      r.type === "NGHI_PHEP" &&
      r.fromTime.getTime() < iv.end.getTime() &&
      r.toTime.getTime() > iv.start.getTime(),
  );

  if (logs.length === 0) {
    if (eff.fullLeaveRequestId != null) {
      related.add(eff.fullLeaveRequestId);
      base.status = "ON_LEAVE";
    } else if (plan.isHoliday) {
      base.status = "HOLIDAY";
    } else if (now.getTime() >= eff.start.getTime() + settings.absentAfterMinutes * MIN) {
      base.status = "ABSENT";
    } else {
      base.status = "NOT_YET";
    }
    base.relatedRequestIds = [...related];
    return base;
  }

  const results = computeDayLogs(plan, logs, requests);
  const first = results[0];
  base.isLate = first.isLate;
  base.lateMinutes = first.isLate ? first.lateMinutes : 0;
  if (first.excusedByRequestId) related.add(first.excusedByRequestId);
  base.status = first.isLate ? "LATE" : "ON_TIME";

  if (results.length > 1) {
    const last = results[results.length - 1];
    base.isEarly = last.isEarly;
    base.earlyMinutes = last.isEarly ? last.earlyMinutes : 0;
    if (last.excusedByRequestId) related.add(last.excusedByRequestId);
    base.workMinutes = workMinutes(shift, base.inTime!, base.outTime!);
    const ot = otMinutes({
      workDate: plan.workDate,
      shift,
      inTime: base.inTime!,
      outTime: base.outTime!,
      requests,
      otRoundMinutes: settings.otRoundMinutes,
    });
    base.otMinutes = ot.minutes;
    ot.requestIds.forEach((id) => related.add(id));
  } else if (now.getTime() > win.end.getTime()) {
    base.missingOut = true;
  }
  base.relatedRequestIds = [...related];
  return base;
}

// ---------------------------------------------------------------------------
// Quy tắc thông báo
// ---------------------------------------------------------------------------

/** Nhắc trễ khi isLate và không có đơn APPROVED/PENDING phủ giờ bắt đầu ca. */
export function shouldSendLateReminder(isLate: boolean, workDate: string, shift: ShiftDef, requests: RequestLite[]): boolean {
  if (!isLate) return false;
  const start = shiftInterval(workDate, shift).start;
  return !requests.some(
    (r) => (r.status === "APPROVED" || r.status === "PENDING") && r.type !== "TANG_CA_OT" && requestCovers(r, start),
  );
}

export type AbsenceDecision =
  | { action: "SKIP"; reason: "HOLIDAY" | "DAY_OFF" | "CHECKED_IN" | "ON_LEAVE" | "NOT_ENROLLED" | "NOT_DUE" | "TOO_OLD" }
  | { action: "DIGEST_ONLY"; reason: "PENDING_LEAVE" }
  | { action: "WARN" };

/**
 * Quyết định cho job absence-check (PRD mục 8). Chỉ xét ca có giờ bắt đầu hiệu lực nằm trong
 * [now − 6h, now − absentAfterMinutes].
 */
export function decideAbsence(args: {
  plan: DayPlan;
  hasIn: boolean;
  enrolled: boolean;
  requests: RequestLite[];
  now: Date;
  absentAfterMinutes: number;
}): AbsenceDecision {
  const { plan, hasIn, enrolled, requests, now, absentAfterMinutes } = args;
  if (plan.isHoliday) return { action: "SKIP", reason: "HOLIDAY" };
  if (!plan.shift || plan.isDayOff) return { action: "SKIP", reason: "DAY_OFF" };
  const eff = effectiveTimes(plan.workDate, plan.shift, requests);
  if (eff.fullLeaveRequestId != null) return { action: "SKIP", reason: "ON_LEAVE" };
  const t = now.getTime();
  const s = eff.start.getTime();
  if (s > t - absentAfterMinutes * MIN) return { action: "SKIP", reason: "NOT_DUE" };
  if (s < t - 6 * 60 * MIN) return { action: "SKIP", reason: "TOO_OLD" };
  if (hasIn) return { action: "SKIP", reason: "CHECKED_IN" };
  if (!enrolled) return { action: "SKIP", reason: "NOT_ENROLLED" };
  const iv = shiftInterval(plan.workDate, plan.shift);
  const pending = requests.some(
    (r) =>
      r.status === "PENDING" &&
      r.type === "NGHI_PHEP" &&
      r.fromTime.getTime() < iv.end.getTime() &&
      r.toTime.getTime() > iv.start.getTime(),
  );
  if (pending) return { action: "DIGEST_ONLY", reason: "PENDING_LEAVE" };
  return { action: "WARN" };
}

export function fmtMinutes(m: number): string {
  if (!m) return "0";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}g${r ? String(r).padStart(2, "0") : ""}` : `${r}p`;
}
