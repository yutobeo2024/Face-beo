import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { dateStr, optId, rosterUpdateSchema } from "@/lib/validators";
import { buildPlanner } from "@/lib/attendance-service";
import { applyCells, lockedCells } from "@/lib/roster";
import { startOfWeek, todayVN, weekDates } from "@/lib/attendance";
import { can, requirePerm } from "@/lib/permissions";

const query = z.object({ week: dateStr.optional(), departmentId: optId, rotatingOnly: z.enum(["0", "1"]).optional() });

export const GET = handle(async (req) => {
  const u = await requirePerm(req, "roster.view");
  const q = parseQuery(req, query);
  const monday = startOfWeek(q.week ?? todayVN());
  const dates = weekDates(monday);
  const emps = await prisma.employee.findMany({
    where: { ...employeeScopeWhere(u, q.departmentId), active: true },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
      defaultShiftId: true,
      _count: { select: { schedules: true } },
    },
  });
  const list = q.rotatingOnly === "1" ? emps.filter((e) => e._count.schedules > 0) : emps;
  const ids = list.map((e) => e.id);
  const [planner, schedules, locked, shifts] = await Promise.all([
    buildPlanner(ids, dates[0], dates[6]),
    prisma.workSchedule.findMany({ where: { employeeId: { in: ids }, date: { gte: dates[0], lte: dates[6] } } }),
    lockedCells(ids, dates),
    prisma.shift.findMany({ orderBy: { startTime: "asc" } }),
  ]);
  const sched = new Set(schedules.map((s) => `${s.employeeId}|${s.date}`));
  const overrideLock = await can(u, "roster.editRegistered");
  return json({
    week: monday,
    dates,
    today: todayVN(),
    shifts,
    holidays: Object.fromEntries(dates.filter((d) => planner.holidays.has(d)).map((d) => [d, planner.holidayNames.get(d)])),
    employees: list.map(({ _count, ...e }) => ({
      ...e,
      rotating: _count.schedules > 0,
      cells: Object.fromEntries(
        dates.map((d) => {
          const p = planner.planFor(e.id, d);
          const k = `${e.id}|${d}`;
          return [
            d,
            {
              shiftId: p.shift?.id ?? null,
              isDayOff: p.isDayOff,
              source: sched.has(k) ? "SCHEDULE" : "DEFAULT",
              locked: !overrideLock && locked.has(k),
            },
          ];
        }),
      ),
    })),
  });
});

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "roster.edit");
  const { cells } = await parseJson(req, rosterUpdateSchema);
  return json(await applyCells(u, cells));
});
