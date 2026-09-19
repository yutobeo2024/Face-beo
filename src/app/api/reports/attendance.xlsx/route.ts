import { badRequest, handle, parseQuery } from "@/lib/api";
import { employeeScopeWhere, requireUser } from "@/lib/auth";
import { rangeQuery } from "@/lib/validators";
import { buildAttendanceReport, reportToXlsx } from "@/lib/reports";

/** GET /api/reports/attendance.xlsx?from=&to=&departmentId= — file BangCong_YYYYMMDD_YYYYMMDD.xlsx, 2 sheet. */
export const GET = handle(async (req) => {
  const u = await requireUser(req, ["ADMIN", "MANAGER"]);
  const q = parseQuery(req, rangeQuery);
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest("Tối đa 62 ngày");
  const report = await buildAttendanceReport(employeeScopeWhere(u, q.departmentId), q.from, q.to);
  const buf = reportToXlsx(report);
  const name = `BangCong_${q.from.replaceAll("-", "")}_${q.to.replaceAll("-", "")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
