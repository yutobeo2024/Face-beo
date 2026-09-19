import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "./lib/session";
import { KIOSK_COOKIE, SESSION_COOKIE } from "./lib/roles";

/**
 * Chặn theo tiền tố (PRD mục 2). Đây chỉ là lớp đầu; mọi API vẫn kiểm tra lại quyền ở server.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/kiosk")) {
    if (pathname === "/kiosk/pair") return NextResponse.next();
    if (!req.cookies.get(KIOSK_COOKIE)?.value) return NextResponse.redirect(new URL("/kiosk/pair", req.url));
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const toLogin = () => {
    const u = new URL("/login", req.url);
    u.searchParams.set("next", pathname + search);
    return NextResponse.redirect(u);
  };

  if (pathname.startsWith("/admin")) {
    if (!session) return toLogin();
    if (session.mcp) return NextResponse.redirect(new URL("/login?change=1", req.url));
    if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.redirect(new URL("/me", req.url));
    return NextResponse.next();
  }
  if (pathname.startsWith("/me")) {
    if (!session) return toLogin();
    if (session.mcp) return NextResponse.redirect(new URL("/login?change=1", req.url));
    return NextResponse.next();
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/me/:path*", "/kiosk/:path*"],
};
