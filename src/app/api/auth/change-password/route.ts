import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validators";
import { cookieOptions, SESSION_TTL_SECONDS, signSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/roles";

export const POST = handle(async (req) => {
  const u = await requireUser(req, undefined, { allowMustChange: true });
  const body = await parseJson(req, changePasswordSchema);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: u.id } });
  if (!(await bcrypt.compare(body.currentPassword, emp.passwordHash))) throw badRequest("Mật khẩu hiện tại không đúng");
  if (body.currentPassword === body.newPassword) throw badRequest("Mật khẩu mới phải khác mật khẩu cũ");
  // Tăng sessionVersion: mọi phiên đã phát hành trước đó (kể cả bản sao cookie bị lộ) hết hiệu lực; chỉ phiên mới dưới đây còn dùng được.
  const updated = await prisma.employee.update({
    where: { id: u.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  const token = await signSession({ sub: String(u.id), role: u.role, name: u.name, mcp: false, sv: updated.sessionVersion });
  const res = json({ ok: true, role: u.role });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
});
