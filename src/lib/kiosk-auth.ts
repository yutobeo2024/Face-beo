import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { sha256 } from "./crypto";
import { unauthorized } from "./api";
import { KIOSK_COOKIE } from "./roles";

/** Token thiết bị: header `Authorization: Bearer`, `x-device-token`, hoặc cookie httpOnly. Server chỉ lưu tokenHash. */
export function deviceTokenFrom(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-device-token") || req.cookies.get(KIOSK_COOKIE)?.value || null;
}

export async function requireDevice(req: NextRequest) {
  const token = deviceTokenFrom(req);
  if (!token) throw unauthorized("Thiếu token thiết bị");
  const d = await prisma.kioskDevice.findUnique({ where: { tokenHash: sha256(token) } });
  if (!d || !d.active) throw unauthorized("Thiết bị chưa ghép hoặc đã bị thu hồi");
  await prisma.kioskDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
  return d;
}
