/** Lớp nạp dữ liệu cho logic chấm công thuần. API gọi các hàm ở đây, không tự tính. */
import type { AttendanceLog, Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  addDays,
  assignScan,
  computeDayLogs,
  findDuplicateScan,
  resolveDayPlan,
  shiftInterval,
  summarizeDay,
  vnDate,
  vnDayRange,
  type DayPlan,
  type DaySummary,
  type RequestLite,
  type ScheduleType,
  type ShiftDef,
  type WeekPattern,
  startOfWeek,
} from "./attendance";
import { getSettings } from "./settings";

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadShifts(db: Db = prisma): Promise<Map<number, ShiftDef>> {
  const rows = await db.shift.findMany();
  return new Map(rows.map((s) => [s.id, s]));
}

/**
 * Bộ lập kế hoạch ngày công cho một nhóm nhân viên trong khoảng ngày (bao gồm biên ±1 ngày để xét ca đêm).
 */
/** Mẫu tuần (cột mon..sun) → map theo thứ ISO 1..7. */
export function patternOf(p: { monShiftId: number | null; tueShiftId: number | null; wedShiftId: number | null; thuShiftId: number | null; friShiftId: number | null; satShiftId: number | null; sunShiftId: number | null } | null): WeekPattern | null {
  if (!p) return null;
  return { 1: p.monShiftId, 2: p.tueShiftId, 3: p.wedShiftId, 4: p.thuShiftId, 5: p.friShiftId, 6: p.satShiftId, 7: p.sunShiftId };
}

/**
 * Bộ lập kế hoạch ngày công cho một nhóm nhân viên trong khoảng ngày (bao gồm biên ±1 ngày để xét ca đêm).
 * Lịch (WorkSchedule) CHỈ có hiệu lực khi tuần của phòng ban đó đã đăng ký (RosterWeek REGISTERED) — bản nháp bị bỏ qua.
 */
export async function buildPlanner(employeeIds: number[], from: string, to: string, db: Db = prisma) {
  const lo = addDays(from, -1);
  const hi = addDays(to, 1);
  const [shifts, emps, schedules, holidays, weeks] = await Promise.all([
    loadShifts(db),
    db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, defaultShiftId: true, departmentId: true, scheduleType: true, workPattern: true },
    }),
    db.workSchedule.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: lo, lte: hi } } }),
    db.holiday.findMany({ where: { date: { gte: lo, lte: hi } } }),
    db.rosterWeek.findMany({ where: { status: "REGISTERED", weekStart: { gte: startOfWeek(lo), lte: startOfWeek(hi) } }, select: { departmentId: true, weekStart: true } }),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const empById = new Map(emps.map((e) => [e.id, e]));
  const sched = new Map(schedules.map((s) => [`${s.employeeId}|${s.date}`, s]));
  const registered = new Set(weeks.map((w) => `${w.departmentId}|${w.weekStart}`));
  const isRegistered = (departmentId: number, date: string) => registered.has(`${departmentId}|${startOfWeek(date)}`);
  return {
    shifts,
    holidays: holidaySet,
    holidayNames: new Map(holidays.map((h) => [h.date, h.name])),
    isRegistered,
    /** Lịch nháp/đã đăng ký thô (để hiển thị bảng xếp ca), không dùng để tính công. */
    rawSchedule: (employeeId: number, date: string) => sched.get(`${employeeId}|${date}`) ?? null,
    planFor(employeeId: number, date: string): DayPlan {
      const e = empById.get(employeeId);
      const reg = e ? isRegistered(e.departmentId, date) : false;
      return resolveDayPlan({
        date,
        schedule: reg ? (sched.get(`${employeeId}|${date}`) ?? null) : null,
        defaultShift: e ? (shifts.get(e.defaultShiftId) ?? null) : null,
        shiftsById: shifts,
        holidays: holidaySet,
        scheduleType: (e?.scheduleType as ScheduleType) ?? "FIXED",
        pattern: patternOf(e?.workPattern ?? null),
        weekRegistered: reg,
      });
    },
  };
}

/** Đơn APPROVED/PENDING giao với khoảng [from, to). */
export async function loadRequests(employeeIds: number[], from: Date, to: Date, db: Db = prisma) {
  return db.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { in: ["APPROVED", "PENDING"] },
      fromTime: { lt: to },
      toTime: { gt: from },
    },
  });
}

function rangeUtc(from: string, to: string) {
  return { start: vnDayRange(addDays(from, -1)).start, end: vnDayRange(addDays(to, 2)).end };
}

const OUT_OF_SHIFT_NOTE = "Ngoài ca";

/**
 * Tính lại toàn bộ log quanh một ngày công: gán lại ca/ngày công cho từng lần quét theo lịch HIỆN TẠI
 * (lịch có thể đã đổi sau khi quét), rồi tính lại IN/OUT, trễ, sớm cho mỗi (ngày công, ca) bị ảnh hưởng.
 */
export async function recomputeDay(employeeId: number, workDate: string, db: Db = prisma) {
  const lo = addDays(workDate, -1);
  const hi = addDays(workDate, 1);
  // Nạp lịch rộng hơn ±2 ngày: assignScan xét hôm qua/hôm nay/ngày mai của giờ quét.
  const planner = await buildPlanner([employeeId], addDays(lo, -1), addDays(hi, 1), db);
  const r = rangeUtc(lo, hi);
  const requests = await loadRequests([employeeId], r.start, r.end, db);
  const logs = await db.attendanceLog.findMany({
    where: { employeeId, workDate: { gte: lo, lte: hi } },
    orderBy: { checkTime: "asc" },
  });

  // 1) Gán lại ca cho từng log.
  const affected = new Set<string>([workDate]);
  for (const l of logs) {
    const a = assignScan(l.checkTime, (d) => planner.planFor(employeeId, d));
    const shiftId = a.plan?.shift?.id ?? null;
    affected.add(l.workDate);
    if (l.workDate !== a.workDate || l.shiftId !== shiftId) {
      const note = shiftId == null ? (l.note ?? OUT_OF_SHIFT_NOTE) : l.note === OUT_OF_SHIFT_NOTE ? null : l.note;
      await db.attendanceLog.update({ where: { id: l.id }, data: { workDate: a.workDate, shiftId, note } });
      l.workDate = a.workDate;
      l.shiftId = shiftId;
      l.note = note;
      affected.add(a.workDate);
    }
  }

  // 2) Tính lại từng nhóm (ngày công, trong ca / ngoài ca).
  const apply = async (group: AttendanceLog[], p: DayPlan) => {
    const res = computeDayLogs(p, group, requests);
    for (let i = 0; i < group.length; i++) {
      const l = group[i];
      const x = res[i];
      if (
        l.type !== x.type ||
        l.isLate !== x.isLate ||
        l.lateMinutes !== x.lateMinutes ||
        l.isEarly !== x.isEarly ||
        l.earlyMinutes !== x.earlyMinutes ||
        l.excusedByRequestId !== x.excusedByRequestId
      ) {
        await db.attendanceLog.update({ where: { id: l.id }, data: x });
      }
    }
  };
  for (const d of affected) {
    const plan = planner.planFor(employeeId, d);
    const dayLogs = logs.filter((l) => l.workDate === d);
    const inShift = dayLogs.filter((l) => l.shiftId != null);
    const outShift = dayLogs.filter((l) => l.shiftId == null);
    if (inShift.length) await apply(inShift, plan);
    if (outShift.length) await apply(outShift, { ...plan, shift: null });
  }
  return { plan: planner.planFor(employeeId, workDate), requests };
}

export type ScanInput = {
  employeeId: number;
  checkTime: Date;
  source: "KIOSK" | "MANUAL";
  deviceId?: number | null;
  clientEventId?: string | null;
  snapshotUrl?: string | null;
  livenessScore?: number | null;
  matchScore?: number | null;
  verified3D?: boolean;
  note?: string | null;
  createdById?: number | null;
  sourceRequestId?: number | null;
};

export type ScanOutcome =
  | { status: "DUPLICATE_EVENT"; log: AttendanceLog }
  | { status: "DUPLICATE"; previous: AttendanceLog }
  | { status: "CREATED"; log: AttendanceLog; plan: DayPlan | null; outOfShift: boolean; requests: RequestLite[] };

/** Ghi một lần quét (kiosk hoặc thủ công) theo đúng quy tắc mục 4. */
/** Ghi một lần quét. Truyền `db` (transaction đang mở) để gộp vào nghiệp vụ lớn hơn — vd. chấm tay theo đơn. */
export async function recordScan(input: ScanInput, db?: Prisma.TransactionClient): Promise<ScanOutcome> {
  const run = async (tx: Prisma.TransactionClient): Promise<ScanOutcome> => {
    if (input.clientEventId) {
      const ex = await tx.attendanceLog.findUnique({ where: { clientEventId: input.clientEventId } });
      if (ex) return { status: "DUPLICATE_EVENT" as const, log: ex };
    }
    if (input.source === "KIOSK") {
      const near = await tx.attendanceLog.findMany({
        where: {
          employeeId: input.employeeId,
          checkTime: {
            gte: new Date(input.checkTime.getTime() - 120_000),
            lte: new Date(input.checkTime.getTime() + 120_000),
          },
        },
      });
      const dup = findDuplicateScan(input.checkTime, near);
      if (dup) return { status: "DUPLICATE" as const, previous: dup };
    }

    const day = vnDate(input.checkTime);
    const planner = await buildPlanner([input.employeeId], day, day, tx);
    const a = assignScan(input.checkTime, (d) => planner.planFor(input.employeeId, d));
    const created = await tx.attendanceLog.create({
      data: {
        employeeId: input.employeeId,
        workDate: a.workDate,
        shiftId: a.plan?.shift?.id ?? null,
        checkTime: input.checkTime,
        type: "IN",
        source: input.source,
        deviceId: input.deviceId ?? null,
        clientEventId: input.clientEventId ?? null,
        snapshotUrl: input.snapshotUrl ?? null,
        livenessScore: input.livenessScore ?? null,
        matchScore: input.matchScore ?? null,
        verified3D: input.verified3D ?? false,
        note: input.note ?? (a.outOfShift ? "Ngoài ca" : null),
        createdById: input.createdById ?? null,
        sourceRequestId: input.sourceRequestId ?? null,
      },
    });
    const { requests } = await recomputeDay(input.employeeId, a.workDate, tx);
    const log = await tx.attendanceLog.findUniqueOrThrow({ where: { id: created.id } });
    return { status: "CREATED" as const, log, plan: a.plan, outOfShift: a.outOfShift, requests };
  };
  return db ? run(db) : prisma.$transaction(run);
}

/** Tổng hợp ngày công cho nhiều nhân viên trong khoảng [from, to] (ngày VN). Key: `${employeeId}|${date}`. */
export async function summarizeRange(employeeIds: number[], from: string, to: string, now = new Date()) {
  const [planner, settings] = await Promise.all([buildPlanner(employeeIds, from, to), getSettings()]);
  const r = rangeUtc(from, to);
  const [logs, requests] = await Promise.all([
    prisma.attendanceLog.findMany({
      where: { employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      orderBy: { checkTime: "asc" },
    }),
    loadRequests(employeeIds, r.start, r.end),
  ]);
  const logsBy = new Map<string, AttendanceLog[]>();
  for (const l of logs) {
    const k = `${l.employeeId}|${l.workDate}`;
    if (!logsBy.has(k)) logsBy.set(k, []);
    logsBy.get(k)!.push(l);
  }
  const reqBy = new Map<number, RequestLite[]>();
  for (const q of requests) {
    if (!reqBy.has(q.employeeId)) reqBy.set(q.employeeId, []);
    reqBy.get(q.employeeId)!.push(q);
  }
  const out = new Map<string, DaySummary & { logs: AttendanceLog[]; plan: DayPlan }>();
  for (const id of employeeIds) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const plan = planner.planFor(id, d);
      const all = logsBy.get(`${id}|${d}`) ?? [];
      const shiftLogs = plan.shift ? all.filter((l) => l.shiftId != null) : all;
      const s = summarizeDay({ plan, logs: shiftLogs, requests: reqBy.get(id) ?? [], now, settings });
      out.set(`${id}|${d}`, { ...s, logs: all, plan });
    }
  }
  return { summaries: out, planner, requests };
}

export function shiftLabel(s: ShiftDef | null | undefined) {
  return s ? `${s.name} ${s.startTime}–${s.endTime}` : "Nghỉ";
}

export { shiftInterval };
