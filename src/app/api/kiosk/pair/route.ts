import { prisma } from "@/lib/db";
import { clientIp, handle, HttpError, json, parseJson } from "@/lib/api";
import { pairSchema } from "@/lib/validators";
import { randomToken, sha256 } from "@/lib/crypto";
import { rateCount, rateLimit } from "@/lib/rate-limit";
import { cookieOptions } from "@/lib/session";
import { KIOSK_COOKIE } from "@/lib/roles";
import { audit } from "@/lib/audit";

// Khóa toàn cục: quá 20 lần nhập sai mã trong 10 phút (mọi IP) => tạm ngừng ghép, chống dò mã 6 số.
const PAIR_FAIL_KEY = "pair-fail:global";
const PAIR_FAIL_LIMIT = 20;
const PAIR_FAIL_WINDOW = 10 * 60_000;
const DEVICE_COOKIE_MAX_AGE = 5 * 365 * 24 * 3600;

/** Tablet nhập mã ghép 6 số (hạn 10 phút) để nhận token thiết bị. */
export const POST = handle(async (req) => {
  const rl = rateLimit(`pair:${clientIp(req)}`, 10);
  if (!rl.ok) throw new HttpError(429, `Thử lại sau ${rl.retryAfter} giây`);
  if (rateCount(PAIR_FAIL_KEY, PAIR_FAIL_WINDOW) >= PAIR_FAIL_LIMIT) {
    throw new HttpError(429, "Nhập sai quá nhiều lần, tạm khóa ghép thiết bị 10 phút");
  }
  const { code } = await parseJson(req, pairSchema);
  const d = await prisma.kioskDevice.findFirst({
    where: { pairCode: code, active: true, pairExpiresAt: { gt: new Date() } },
  });
  if (!d) {
    rateLimit(PAIR_FAIL_KEY, Number.MAX_SAFE_INTEGER, PAIR_FAIL_WINDOW);
    throw new HttpError(400, "Mã ghép không đúng hoặc đã hết hạn");
  }
  const token = randomToken(32);
  await prisma.kioskDevice.update({
    where: { id: d.id },
    data: { tokenHash: sha256(token), pairCode: null, pairExpiresAt: null, lastSeenAt: new Date() },
  });
  await audit({ action: "DEVICE_PAIR", entity: "KioskDevice", entityId: d.id, detail: { ip: clientIp(req) } });
  const res = json({ ok: true, device: { id: d.id, name: d.name, location: d.location }, token });
  res.cookies.set(KIOSK_COOKIE, token, cookieOptions(DEVICE_COOKIE_MAX_AGE));
  return res;
});
