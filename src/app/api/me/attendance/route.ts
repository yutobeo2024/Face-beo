import { z } from "zod";
import { DateTime } from "luxon";
import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { summarizeRange } from "@/lib/attendance-service";
import { TZ, todayVN } from "@/lib/attendance";
import { toDayRow } from "@/lib/day-rows";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lịch sử công theo tháng của chính nhân viên. */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const q = parseQuery(req, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }));
  const month = q.month ?? todayVN().slice(0, 7);
  const start = DateTime.fromISO(`${month}-01`, { zone: TZ });
  const from = start.toISODate()!;
  const to = start.endOf("month").toISODate()!;
  const { summaries } = await summarizeRange([u.id], from, to);
  const days = [...summaries.values()].map(toDayRow);
  const totals = {
    workDays: r2(days.reduce((s, d) => s + d.workDayUnits, 0)),
    lateCount: days.filter((d) => d.isLate).length,
    lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
    earlyCount: days.filter((d) => d.isEarly).length,
    earlyMinutes: days.reduce((s, d) => s + d.earlyMinutes, 0),
    otMinutes: days.reduce((s, d) => s + d.otMinutes, 0),
    workMinutes: days.reduce((s, d) => s + d.workMinutes, 0),
    leaveDays: r2(days.reduce((s, d) => s + d.leaveDayUnits, 0)),
    absentDays: days.filter((d) => d.status === "ABSENT").length,
    missingOut: days.filter((d) => d.missingOut).length,
  };
  return json({ month, days, totals });
});
