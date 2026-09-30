import { prisma } from "@/lib/db";
import { forbidden, handle, notFound } from "@/lib/api";
import { canManageDept } from "@/lib/auth";
import { requirePerm } from "@/lib/permissions";
import { readCrop } from "@/lib/uniform-storage";

/**
 * Ảnh vùng áo: chỉ người có quyền `uniform.view` trong phạm vi phòng của bản ghi.
 * Ảnh này KHÔNG chứa khuôn mặt (vùng cắt luôn nằm dưới cằm) nên không phải dữ liệu sinh trắc,
 * nhưng vẫn là ảnh chụp nhân viên nên không để ngoài public và không cho xem chéo phòng.
 */
export const GET = handle<{ path: string[] }>(async (req, ctx) => {
  const u = await requirePerm(req, "uniform.view");
  const parts = (await ctx.params).path;
  const url = `/api/uniform/crops/${parts.join("/")}`;
  const row = await prisma.uniformCheck.findFirst({ where: { cropUrl: url }, select: { departmentId: true } });
  if (!row) throw notFound("Ảnh đã bị xóa hoặc không tồn tại");
  if (!canManageDept(u, row.departmentId)) throw forbidden();
  const buf = await readCrop(parts);
  if (!buf) throw notFound("Ảnh đã bị xóa hoặc không tồn tại");
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
});
