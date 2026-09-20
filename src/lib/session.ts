/** JWT session — dùng được cả ở middleware (edge) lẫn Node. */
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./roles";

export type SessionPayload = {
  sub: string; // employee id
  role: Role;
  name: string;
  mcp: boolean; // mustChangePassword
  sv?: number; // Employee.sessionVersion lúc phát hành — lệch với DB => phiên đã bị thu hồi (thiếu = 0)
};

export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

function key() {
  const s =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV !== "production" ? "dev-session-secret-please-change-0123456789" : "");
  if (!s) throw new Error("Thiếu SESSION_SECRET");
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ role: p.role, name: p.name, mcp: p.mcp, sv: p.sv ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return {
      sub: String(payload.sub),
      role: payload.role as Role,
      name: String(payload.name ?? ""),
      mcp: Boolean(payload.mcp),
      sv: typeof payload.sv === "number" ? payload.sv : 0,
    };
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
