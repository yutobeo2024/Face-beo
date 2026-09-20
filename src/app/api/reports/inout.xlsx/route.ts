import { badRequest, handle, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { rangeQuery } from "@/lib/validators";
import { buildInOutMatrix, inOutToXlsx } from "@/lib/reports";
import { requirePerm } from "@/lib/permissions";

/** GET /api/reports/inout.xlsx?from=&to=&departmentId= — mẫu ma trận giờ vào/ra theo ngày, file GioVaoRa_YYYYMMDD_YYYYMMDD.xlsx. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "reports.view");
  const q = parseQuery(req, rangeQuery);
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest("Tối đa 62 ngày");
  const matrix = await buildInOutMatrix(employeeScopeWhere(u, q.departmentId), q.from, q.to);
  const buf = await inOutToXlsx(matrix);
  const name = `GioVaoRa_${q.from.replaceAll("-", "")}_${q.to.replaceAll("-", "")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
