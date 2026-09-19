import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { TZ } from "@/lib/attendance";
import { fmtMonth } from "@/lib/payroll-lock-state";
import { badRequest, handle, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { rangeQuery } from "@/lib/validators";
import { buildAttendanceReport, reportToXlsx } from "@/lib/reports";
import { requirePerm } from "@/lib/permissions";

/** GET /api/reports/attendance.xlsx?from=&to=&departmentId= — file BangCong_YYYYMMDD_YYYYMMDD.xlsx, 2 sheet. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "reports.view");
  const q = parseQuery(req, rangeQuery);
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest("Tối đa 62 ngày");
  const report = await buildAttendanceReport(employeeScopeWhere(u, q.departmentId), q.from, q.to);
  // Ghi chú các tháng đã chốt công nằm trong kỳ báo cáo.
  const locks = await prisma.payrollLock.findMany({ where: { month: { gte: q.from.slice(0, 7), lte: q.to.slice(0, 7) } }, orderBy: { month: "asc" } });
  const notes = locks.map((l) => `Tháng ${fmtMonth(l.month)} đã chốt công lúc ${DateTime.fromJSDate(l.lockedAt).setZone(TZ).toFormat("HH:mm dd/MM/yyyy")} — số liệu lấy từ bản chốt.`);
  const buf = reportToXlsx(report, notes);
  const name = `BangCong_${q.from.replaceAll("-", "")}_${q.to.replaceAll("-", "")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
