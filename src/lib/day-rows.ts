/** Chuyển tổng hợp ngày công thành dạng JSON cho giao diện. */
import type { AttendanceLog } from "@prisma/client";
import { vnTime, type DayPlan, type DaySummary } from "./attendance";

export type DayRowLog = {
  id: number;
  type: string;
  time: string;
  checkTime: string;
  source: string;
  isLate: boolean;
  lateMinutes: number;
  isEarly: boolean;
  earlyMinutes: number;
  snapshotUrl: string | null;
  matchScore: number | null;
  livenessScore: number | null;
  verified3D: boolean;
  outOfShift: boolean;
  note: string | null;
  excusedByRequestId: number | null;
};

export function toDayRow(s: DaySummary & { logs: AttendanceLog[]; plan: DayPlan }) {
  return {
    date: s.workDate,
    status: s.status,
    shift: s.shift ? { id: s.shift.id, name: s.shift.name, startTime: s.shift.startTime, endTime: s.shift.endTime } : null,
    isHoliday: s.plan.isHoliday,
    inTime: s.inTime ? vnTime(s.inTime) : null,
    outTime: s.outTime ? vnTime(s.outTime) : null,
    isLate: s.isLate,
    lateMinutes: s.lateMinutes,
    isEarly: s.isEarly,
    earlyMinutes: s.earlyMinutes,
    workMinutes: s.workMinutes,
    otMinutes: s.otMinutes,
    missingOut: s.missingOut,
    holidayWork: s.holidayWork,
    pendingLeave: s.pendingLeave,
    hasManual: s.hasManual,
    relatedRequestIds: s.relatedRequestIds,
    logs: s.logs.map(
      (l): DayRowLog => ({
        id: l.id,
        type: l.type,
        time: vnTime(l.checkTime),
        checkTime: l.checkTime.toISOString(),
        source: l.source,
        isLate: l.isLate,
        lateMinutes: l.lateMinutes,
        isEarly: l.isEarly,
        earlyMinutes: l.earlyMinutes,
        snapshotUrl: l.snapshotUrl,
        matchScore: l.matchScore,
        livenessScore: l.livenessScore,
        verified3D: l.verified3D,
        outOfShift: l.shiftId == null,
        note: l.note,
        excusedByRequestId: l.excusedByRequestId,
      }),
    ),
  };
}
