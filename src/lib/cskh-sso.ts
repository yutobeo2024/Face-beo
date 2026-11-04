// Đăng nhập một lần sang Dashboard CSKH (bot Zalo của phòng khám, repo Zalo-hermess).
// Vé = b64url(payload) + "." + b64url(HMAC-SHA256(CSKH_SSO_SECRET, payload)),
// payload = "v1|<admin|staff>|<giây phát hành>|<nonce>|<mã nhân viên>". Dashboard nhận vé trong 120 giây, dùng một lần,
// rồi tự mở phiên của nó (cskh_engine/dashboard.py: DashboardAuth.redeem_sso). Bí mật dùng chung giữa hai bên.
import { createHmac, randomBytes } from "node:crypto";

export type CskhRole = "admin" | "staff";

export function makeCskhTicket(
  secret: string,
  role: CskhRole,
  user: string,
  issuedAt: number = Math.floor(Date.now() / 1000),
  nonce: string = randomBytes(8).toString("hex"),
): string {
  const payload = `v1|${role}|${Math.floor(issuedAt)}|${nonce}|${user}`;
  const sig = createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export function cskhSsoUrl(base: string, ticket: string): string {
  return `${base.replace(/\/+$/, "")}/dashboard/sso?t=${encodeURIComponent(ticket)}`;
}
