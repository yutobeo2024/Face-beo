import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { dateStr } from "@/lib/validators";
import { summarizeRange } from "@/lib/attendance-service";
import { startOfWeek, todayVN, weekDates } from "@/lib/attendance";
import { toDayRow } from "@/lib/day-rows";
import { FACE_MODEL_VERSION } from "@/lib/roles";

/** Lịch tuần + trạng thái công hôm nay của chính nhân viên. */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const q = parseQuery(req, z.object({ week: dateStr.optional() }));
  const today = todayVN();
  const monday = startOfWeek(q.week ?? today);
  const dates = weekDates(monday);
  const lo = dates[0] < today ? dates[0] : today;
  const hi = dates[6] > today ? dates[6] : today;
  const { summaries, planner } = await summarizeRange([u.id], lo, hi);
  const [emp, pending, faces] = await Promise.all([
    prisma.employee.findUniqueOrThrow({
      where: { id: u.id },
      select: { code: true, name: true, zaloLinkedAt: true, department: { select: { name: true } }, defaultShift: { select: { name: true, startTime: true, endTime: true } } },
    }),
    prisma.leaveRequest.count({ where: { employeeId: u.id, status: "PENDING" } }),
    prisma.faceTemplate.count({ where: { employeeId: u.id, modelVersion: FACE_MODEL_VERSION } }),
  ]);
  return json({
    me: { ...emp, role: u.role, faceEnrolled: faces > 0 },
    today: toDayRow(summaries.get(`${u.id}|${today}`)!),
    week: monday,
    days: dates.map((d) => ({ ...toDayRow(summaries.get(`${u.id}|${d}`)!), holidayName: planner.holidayNames.get(d) ?? null })),
    pendingRequests: pending,
  });
});
