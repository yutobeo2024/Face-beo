import { z } from "zod";
import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { dateStr } from "@/lib/validators";
import { REQUEST_TYPES } from "@/lib/roles";
import { buildPlanner } from "@/lib/attendance-service";
import { shiftInterval, vnDayRange } from "@/lib/attendance";

/** Gợi ý giờ theo ca của ngày đó: VE_SOM = 1 giờ cuối ca, TANG_CA_OT = 2 giờ sau ca, NGHI_PHEP = cả ca. */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const q = parseQuery(req, z.object({ date: dateStr, type: z.enum(REQUEST_TYPES) }));
  const planner = await buildPlanner([u.id], q.date, q.date);
  const plan = planner.planFor(u.id, q.date);
  if (!plan.shift) {
    const r = vnDayRange(q.date);
    return json({ shift: null, fromTime: r.start.toISOString(), toTime: r.end.toISOString() });
  }
  const iv = shiftInterval(q.date, plan.shift);
  const H = 3600_000;
  const [from, to] =
    q.type === "VE_SOM"
      ? [new Date(iv.end.getTime() - H), iv.end]
      : q.type === "TANG_CA_OT"
        ? [iv.end, new Date(iv.end.getTime() + 2 * H)]
        : [iv.start, iv.end];
  return json({ shift: plan.shift, fromTime: from.toISOString(), toTime: to.toISOString() });
});
