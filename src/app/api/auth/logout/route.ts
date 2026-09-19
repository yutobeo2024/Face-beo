import { handle, json } from "@/lib/api";
import { cookieOptions } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/roles";

export const POST = handle(async () => {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
});
