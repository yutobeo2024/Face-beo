import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { notifyRequestCancelled } from "@/lib/notify";

/** Nhân viên hủy đơn của mình khi còn PENDING. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const r = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (r.employeeId !== u.id) throw forbidden();
  if (r.status !== "PENDING") throw badRequest("Chỉ hủy được đơn đang chờ duyệt");
  const upd = await prisma.leaveRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!upd.count) throw badRequest("Đơn đã được xử lý");
  await notifyRequestCancelled(r);
  return json({ ok: true });
});
