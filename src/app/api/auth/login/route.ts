import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { clientIp, handle, HttpError, json, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validators";
import { cookieOptions, SESSION_TTL_SECONDS, signSession } from "@/lib/session";
import { SESSION_COOKIE, type Role } from "@/lib/roles";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Hash giả để so sánh khi không tìm thấy tài khoản, tránh lộ thông tin qua thời gian phản hồi.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("dummy-password", 10));

export const POST = handle(async (req) => {
  const rl = rateLimit(`login:${clientIp(req)}`, 10);
  if (!rl.ok) throw new HttpError(429, `Thử lại sau ${rl.retryAfter} giây`);
  const { login, password } = await parseJson(req, loginSchema);

  const emp = await prisma.employee.findFirst({
    where: { OR: [{ code: login.toUpperCase() }, { code: login }, { phone: login }] },
  });
  if (!emp || !emp.active) {
    await bcrypt.compare(password, getDummyHash());
    throw new HttpError(401, "Sai mã nhân viên/số điện thoại hoặc mật khẩu");
  }
  if (emp.lockedUntil && emp.lockedUntil > new Date()) {
    const mins = Math.ceil((emp.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `Tài khoản tạm khóa, thử lại sau ${mins} phút`);
  }
  const ok = await bcrypt.compare(password, emp.passwordHash);
  if (!ok) {
    const fails = emp.failedLogins + 1;
    const lock = fails >= MAX_FAILS;
    await prisma.employee.update({
      where: { id: emp.id },
      data: { failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    throw new HttpError(
      lock ? 423 : 401,
      lock ? `Sai quá ${MAX_FAILS} lần, tài khoản bị khóa ${LOCK_MINUTES} phút` : `Sai mật khẩu (còn ${MAX_FAILS - fails} lần thử)`,
    );
  }
  await prisma.employee.update({ where: { id: emp.id }, data: { failedLogins: 0, lockedUntil: null } });

  const token = await signSession({ sub: String(emp.id), role: emp.role as Role, name: emp.name, mcp: emp.mustChangePassword });
  const res = json({ ok: true, role: emp.role, mustChangePassword: emp.mustChangePassword, name: emp.name });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
});
