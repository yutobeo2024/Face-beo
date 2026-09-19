import { prisma } from "@/lib/db";
import { handle, json, parseJson } from "@/lib/api";
import { deviceCreateSchema } from "@/lib/validators";
import { randomDigits } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

const PAIR_TTL_MS = 10 * 60_000;

export const GET = handle(async (req) => {
  await requirePerm(req, "devices.manage");
  const devices = await prisma.kioskDevice.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, location: true, active: true, lastSeenAt: true, pairCode: true, pairExpiresAt: true, tokenHash: true },
  });
  return json({
    devices: devices.map(({ tokenHash, pairCode, pairExpiresAt, ...d }) => ({
      ...d,
      paired: !!tokenHash,
      pairCode: pairExpiresAt && pairExpiresAt > new Date() ? pairCode : null,
      pairExpiresAt: pairExpiresAt && pairExpiresAt > new Date() ? pairExpiresAt : null,
    })),
  });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "devices.manage");
  const body = await parseJson(req, deviceCreateSchema);
  const d = await prisma.kioskDevice.create({
    data: { name: body.name, location: body.location || null, pairCode: randomDigits(6), pairExpiresAt: new Date(Date.now() + PAIR_TTL_MS) },
  });
  await audit({ actorId: u.id, action: "DEVICE_CREATE", entity: "KioskDevice", entityId: d.id, detail: { name: d.name } });
  return json({ device: { id: d.id, name: d.name, pairCode: d.pairCode, pairExpiresAt: d.pairExpiresAt } }, { status: 201 });
});
