import { prisma } from "@/lib/db";
import { handle, idParam, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

/** Thu hồi thiết bị: xóa tokenHash, vô hiệu hóa ngay. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "devices.manage");
  const id = await idParam(ctx);
  const d = await prisma.kioskDevice.findUnique({ where: { id } });
  if (!d) throw notFound();
  await prisma.kioskDevice.update({ where: { id }, data: { active: false, tokenHash: null, pairCode: null, pairExpiresAt: null } });
  await audit({ actorId: u.id, action: "DEVICE_REVOKE", entity: "KioskDevice", entityId: id, detail: { name: d.name } });
  return json({ ok: true });
});
