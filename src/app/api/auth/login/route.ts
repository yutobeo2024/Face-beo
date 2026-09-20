import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { clientIp, handle, HttpError, json, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validators";
import { cookieOptions, SESSION_TTL_SECONDS, signSession } from "@/lib/session";
import { SESSION_COOKIE, type Role } from "@/lib/roles";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Một thông báo chung cho "không có tài khoản" và "sai mật khẩu" — không để lộ tài khoản nào tồn tại.
const GENERIC_FAIL = "Sai mã nhân viên/số điện thoại hoặc mật khẩu";
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
    throw new HttpError(401, GENERIC_FAIL);
  }
  if (emp.lockedUntil && emp.lockedUntil > new Date()) {
    const mins = Math.ceil((emp.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `Tài khoản tạm khóa, thử lại sau ${mins} phút`);
  }
  const ok = await bcrypt.compare(password, emp.passwordHash);
  if (!ok) {
    // Tăng bộ đếm nguyên tử trong DB (không đọc-rồi-ghi): nhiều yêu cầu sai đồng thời vẫn cộng đủ và khóa đúng lúc.
    const r = await prisma.employee.update({ where: { id: emp.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
    if (r.failedLogins >= MAX_FAILS) {
      await prisma.employee.update({ where: { id: emp.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
      throw new HttpError(423, `Sai quá ${MAX_FAILS} lần, tài khoản bị khóa ${LOCK_MINUTES} phút`);
    }
    throw new HttpError(401, GENERIC_FAIL);
  }
  await prisma.employee.update({ where: { id: emp.id }, data: { failedLogins: 0, lockedUntil: null } });

  const token = await signSession({ sub: String(emp.id), role: emp.role as Role, name: emp.name, mcp: emp.mustChangePassword, sv: emp.sessionVersion });
  const res = json({ ok: true, role: emp.role, mustChangePassword: emp.mustChangePassword, name: emp.name });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
});
