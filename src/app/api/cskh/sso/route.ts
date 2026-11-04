import { NextResponse, type NextRequest } from "next/server";
import { HttpError, handle } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { cskhSsoUrl, makeCskhTicket } from "@/lib/cskh-sso";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const PATH = "/api/cskh/sso";

/** Mục menu mở tab mới, nên lỗi trả trang HTML ngắn thay vì JSON thô. */
function page(status: number, title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#1e293b">
<h1 style="font-size:1.25rem">${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">Về Face Beo</a></p></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Mục menu "Dashboard CSKH": ký vé đăng nhập một lần (120 giây, dùng một lần) rồi chuyển sang dashboard của bot Zalo.
 * Quyền: `cskh.admin` → vai quản trị bên dashboard, `cskh.view` → vai lễ tân. ADMIN luôn có cả hai.
 * Chỉ cấp vé khi lượt mở đến từ chính Face Beo (Sec-Fetch-Site same-origin) hoặc người dùng tự gõ địa chỉ (none):
 * trang khác không ép được người đang đăng nhập Face Beo vào dashboard.
 */
export const GET = handle(async (req: NextRequest) => {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return page(403, "Không mở được Dashboard CSKH", "Hãy mở từ menu Dashboard CSKH trong Face Beo.");
  }
  let u;
  try {
    u = await requireUser(req);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      const login = new URL("/login", req.url);
      login.searchParams.set("next", PATH);
      return NextResponse.redirect(login, 307);
    }
    throw e;
  }
  const [view, admin] = await Promise.all([can(u, "cskh.view"), can(u, "cskh.admin")]);
  if (!view && !admin) {
    return page(403, "Chưa được cấp quyền", "Tài khoản của bạn chưa được cấp quyền Dashboard CSKH. Liên hệ Quản trị.");
  }
  const secret = env.cskhSsoSecret;
  const base = env.cskhDashboardUrl;
  if (secret.length < 32 || !/^https:\/\//.test(base)) {
    return page(503, "Chưa cấu hình Dashboard CSKH", "Quản trị cần đặt CSKH_SSO_SECRET và CSKH_DASHBOARD_URL (xem docs/DEPLOY-VPS.md).");
  }
  const role = admin ? "admin" : "staff";
  await audit({ actorId: u.id, action: "CSKH_SSO", entity: "cskh", detail: { role } });
  const res = NextResponse.redirect(cskhSsoUrl(base, makeCskhTicket(secret, role, u.code)), 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
});
