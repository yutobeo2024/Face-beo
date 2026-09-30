import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, parseQuery } from "@/lib/api";
import { employeeScopeWhere } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { buildUniformReport, uniformToXlsx } from "@/lib/uniform-report";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departmentId: z.coerce.number().int().positive().optional(),
  mode: z.enum(["ON", "SHADOW"]).optional(),
});

/** GET /api/reports/uniform.xlsx?from=&to=&departmentId=&mode= — file DongPhuc_YYYYMMDD_YYYYMMDD.xlsx, 3 sheet. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "uniform.view");
  const q = parseQuery(req, querySchema);
  if (q.to < q.from) throw badRequest("Khoảng ngày không hợp lệ");
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest("Tối đa 62 ngày");

  const report = await buildUniformReport(employeeScopeWhere(u, q.departmentId), q.from, q.to, q.mode);
  // Nhắc rõ phòng nào đang chạy thử: số liệu của phòng đó không dùng để xử lý nhân sự.
  const shadow = await prisma.department.findMany({ where: { uniformMode: "SHADOW" }, select: { name: true }, orderBy: { name: "asc" } });
  const notes = shadow.length ? [`Đang chạy thử (không dùng để xử lý nhân sự): ${shadow.map((d) => d.name).join(", ")}.`] : [];

  const buf = await uniformToXlsx(report, notes);
  const name = `DongPhuc_${q.from.replaceAll("-", "")}_${q.to.replaceAll("-", "")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
