import { prisma } from "@/lib/db";
import { forbidden, handle, notFound } from "@/lib/api";
import { canManageDept, deptScope } from "@/lib/auth";
import { readSnapshot } from "@/lib/storage";
import { can, requirePerm } from "@/lib/permissions";

/** Snapshot: người có quyền `snapshots.view` trong phạm vi phòng ban (ADMIN/HR toàn công ty, quản lý phòng mình).
 * Ảnh của lần quét bị từ chối (không gắn log) cần thêm quyền `suspicious.view`. */
export const GET = handle<{ path: string[] }>(async (req, ctx) => {
  const u = await requirePerm(req, "snapshots.view");
  const parts = (await ctx.params).path;
  const url = `/api/snapshots/${parts.join("/")}`;
  const log = await prisma.attendanceLog.findFirst({ where: { snapshotUrl: url }, select: { employee: { select: { departmentId: true } } } });
  if (log) {
    if (deptScope(u) !== null && !canManageDept(u, log.employee.departmentId)) throw forbidden();
  } else if (!(await can(u, "suspicious.view"))) {
    throw forbidden();
  }
  const buf = await readSnapshot(parts);
  if (!buf) throw notFound("Ảnh đã bị xóa hoặc không tồn tại");
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
});
