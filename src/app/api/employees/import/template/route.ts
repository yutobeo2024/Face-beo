import { handle } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { buildImportTemplate } from "@/lib/employee-import";

/** File Excel mẫu để nhập nhân viên: danh sách thả xuống lấy từ danh mục hiện tại (phòng, chức danh, chuyên khoa, ca, mẫu tuần). */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "employees.manage");
  const buf = await buildImportTemplate(u);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="MauNhapNhanVien.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});
