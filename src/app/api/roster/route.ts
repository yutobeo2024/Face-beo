import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseJson, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { dateStr, optId, rosterUpdateSchema } from "@/lib/validators";
import { buildPlanner } from "@/lib/attendance-service";
import { applyCells, editRule, weekKey, weekStatuses } from "@/lib/roster";
import { startOfWeek, todayVN, weekDates } from "@/lib/attendance";
import { can, requirePerm } from "@/lib/permissions";

const query = z.object({
  week: dateStr.optional(),
  departmentId: optId,
  // mặc định chỉ hiện nhóm xoay ca; "all" = hiện cả nhóm cố định
  group: z.enum(["rotating", "all"]).default("rotating"),
});

export const GET = handle(async (req) => {
  const u = await requirePerm(req, "roster.view");
  const q = parseQuery(req, query);
  const monday = startOfWeek(q.week ?? todayVN());
  const dates = weekDates(monday);
  const emps = await prisma.employee.findMany({
    where: { ...employeeScopeWhere(u, q.departmentId), active: true, ...(q.group === "rotating" ? { scheduleType: "ROTATING" } : {}) },
    orderBy: [{ departmentId: "asc" }, { scheduleType: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
      defaultShiftId: true,
      scheduleType: true,
      workPattern: { select: { name: true } },
    },
  });
  const ids = emps.map((e) => e.id);
  const deptIds = [...new Set(emps.map((e) => e.departmentId))];
  const [planner, statuses, shifts, depts] = await Promise.all([
    buildPlanner(ids, dates[0], dates[6]),
    weekStatuses(deptIds, [monday]),
    prisma.shift.findMany({ orderBy: { startTime: "asc" } }),
    prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
  ]);

  // Trạng thái tuần theo phòng + quyền của người xem với từng phòng.
  const weekInfo: Record<number, { name: string; status: string; registeredAt: Date | null; canEdit: boolean; needReason: boolean; lockReason: string | null; canRegister: boolean }> = {};
  for (const d of depts) {
    const st = statuses.get(weekKey(d.id, monday));
    const registered = st?.status === "REGISTERED";
    const rule = await editRule(u, d.id, monday, registered);
    weekInfo[d.id] = {
      name: d.name,
      status: registered ? "REGISTERED" : "DRAFT",
      registeredAt: st?.registeredAt ?? null,
      canEdit: rule.allowed,
      needReason: rule.needReason,
      lockReason: rule.reason,
      canRegister: !registered && rule.allowed,
    };
  }

  return json({
    week: monday,
    dates,
    today: todayVN(),
    shifts,
    canEditRegistered: await can(u, "roster.editRegistered"),
    departments: weekInfo,
    holidays: Object.fromEntries(dates.filter((d) => planner.holidays.has(d)).map((d) => [d, planner.holidayNames.get(d)])),
    employees: emps.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      departmentId: e.departmentId,
      department: e.department,
      defaultShiftId: e.defaultShiftId,
      scheduleType: e.scheduleType,
      patternName: e.workPattern?.name ?? null,
      cells: Object.fromEntries(
        dates.map((d) => {
          const raw = planner.rawSchedule(e.id, d);
          const registered = weekInfo[e.departmentId]?.status === "REGISTERED";
          if (raw) {
            return [d, { shiftId: raw.isDayOff ? null : raw.shiftId, isDayOff: raw.isDayOff || raw.shiftId == null, source: "SCHEDULE", draft: !registered }];
          }
          const p = planner.planFor(e.id, d);
          if (p.unscheduled) return [d, { shiftId: null, isDayOff: false, source: "NONE", draft: false }];
          return [d, { shiftId: p.shift?.id ?? null, isDayOff: p.isDayOff, source: p.source === "PATTERN" ? "PATTERN" : "DEFAULT", draft: false }];
        }),
      ),
    })),
  });
});

const putSchema = rosterUpdateSchema.extend({ reason: z.string().trim().max(300).optional() });

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "roster.edit");
  const { cells, reason } = await parseJson(req, putSchema);
  return json(await applyCells(u, cells, reason));
});
