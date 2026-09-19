import { badRequest, handle, json, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { rangeQuery } from "@/lib/validators";
import { buildAttendanceReport } from "@/lib/reports";
import { requirePerm } from "@/lib/permissions";

export const GET = handle(async (req) => {
  const u = await requirePerm(req, "reports.view");
  const q = parseQuery(req, rangeQuery);
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest("Tối đa 62 ngày");
  const r = await buildAttendanceReport(employeeScopeWhere(u, q.departmentId), q.from, q.to);
  return json({ from: q.from, to: q.to, summary: r.summary, detail: r.detail });
});
