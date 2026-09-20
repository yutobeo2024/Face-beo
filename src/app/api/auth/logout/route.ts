import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { userFromRequest } from "@/lib/auth";
import { cookieOptions } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/roles";

/** Đăng xuất = thu hồi MỌI phiên của tài khoản (tăng sessionVersion), không chỉ xóa cookie ở trình duyệt này. */
export const POST = handle(async (req) => {
  const u = await userFromRequest(req);
  if (u) await prisma.employee.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } });
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
});
