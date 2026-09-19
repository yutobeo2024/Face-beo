import { z } from "zod";
import { handle, json, parseJson } from "@/lib/api";
import { can, requirePerm } from "@/lib/permissions";
import { lockMonth, recentMonths } from "@/lib/payroll-lock";

/** Trạng thái chốt công 6 tháng gần nhất. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, ["reports.view", "payroll.lock"]);
  const [canLock, canUnlock] = await Promise.all([can(u, "payroll.lock"), can(u, "payroll.unlock")]);
  return json({ months: await recentMonths(6), canLock, canUnlock });
});

/** Chốt công một tháng đã kết thúc. */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "payroll.lock");
  const { month } = await parseJson(req, z.object({ month: z.string() }));
  const totals = await lockMonth(u, month);
  return json({ month, totals });
});
