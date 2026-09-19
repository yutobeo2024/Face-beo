import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { randomLinkCode } from "@/lib/crypto";
import { isZaloSimulated } from "@/lib/zalo-token";

const TTL_MS = 15 * 60_000;

export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const [emp, code] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: u.id }, select: { zaloUserId: true, zaloLinkedAt: true } }),
    prisma.zaloLinkCode.findFirst({ where: { employeeId: u.id, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } }),
  ]);
  return json({
    linked: !!emp.zaloUserId,
    linkedAt: emp.zaloLinkedAt,
    code: code?.code ?? null,
    expiresAt: code?.expiresAt ?? null,
    simulated: isZaloSimulated(),
    oaName: process.env.ZALO_OA_NAME || "Face Beo",
  });
});

/** Sinh mã liên kết 6 ký tự, hạn 15 phút (thay mã cũ). */
export const POST = handle(async (req) => {
  const u = await requireUser(req);
  await prisma.zaloLinkCode.deleteMany({ where: { employeeId: u.id } });
  let code = randomLinkCode();
  for (let i = 0; i < 5 && (await prisma.zaloLinkCode.findUnique({ where: { code } })); i++) code = randomLinkCode();
  const row = await prisma.zaloLinkCode.create({ data: { code, employeeId: u.id, expiresAt: new Date(Date.now() + TTL_MS) } });
  return json({ code: row.code, expiresAt: row.expiresAt });
});

/** Hủy liên kết Zalo của chính mình. */
export const DELETE = handle(async (req) => {
  const u = await requireUser(req);
  await prisma.employee.update({ where: { id: u.id }, data: { zaloUserId: null, zaloLinkedAt: null } });
  return json({ ok: true });
});
