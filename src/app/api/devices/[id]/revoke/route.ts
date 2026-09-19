import { prisma } from "@/lib/db";
import { handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

/** Thu hồi thiết bị: xóa tokenHash, vô hiệu hóa ngay. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const d = await prisma.kioskDevice.findUnique({ where: { id } });
  if (!d) throw notFound();
  await prisma.kioskDevice.update({ where: { id }, data: { active: false, tokenHash: null, pairCode: null, pairExpiresAt: null } });
  await audit({ actorId: u.id, action: "DEVICE_REVOKE", entity: "KioskDevice", entityId: id, detail: { name: d.name } });
  return json({ ok: true });
});
