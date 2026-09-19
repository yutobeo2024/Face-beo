import { prisma } from "@/lib/db";
import { handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { randomDigits } from "@/lib/crypto";
import { audit } from "@/lib/audit";

/** Sinh mã ghép mới (hạn 10 phút). Ghép lại sẽ thay token cũ. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req, ["ADMIN"]);
  const id = await idParam(ctx);
  const d = await prisma.kioskDevice.findUnique({ where: { id } });
  if (!d) throw notFound();
  const updated = await prisma.kioskDevice.update({
    where: { id },
    data: { pairCode: randomDigits(6), pairExpiresAt: new Date(Date.now() + 10 * 60_000), active: true },
  });
  await audit({ actorId: u.id, action: "DEVICE_CREATE", entity: "KioskDevice", entityId: id, detail: { regenerate: true } });
  return json({ pairCode: updated.pairCode, pairExpiresAt: updated.pairExpiresAt });
});
