import { prisma } from "@/lib/db";
import { forbidden, handle, notFound } from "@/lib/api";
import { canManageDept, requireUser } from "@/lib/auth";
import { readSnapshot } from "@/lib/storage";

/** Snapshot chỉ ADMIN và quản lý trực tiếp xem được (PRD mục 9). */
export const GET = handle<{ path: string[] }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN", "MANAGER"]);
  const parts = (await ctx.params).path;
  const url = `/api/snapshots/${parts.join("/")}`;
  if (u.role !== "ADMIN") {
    const log = await prisma.attendanceLog.findFirst({ where: { snapshotUrl: url }, select: { employee: { select: { departmentId: true } } } });
    if (!log || !canManageDept(u, log.employee.departmentId)) throw forbidden();
  }
  const buf = await readSnapshot(parts);
  if (!buf) throw notFound("Ảnh đã bị xóa hoặc không tồn tại");
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
});
