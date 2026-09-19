/** Token Zalo OA (lưu DB, tự refresh có khóa) và transport gửi tin. Dùng nội bộ bởi zalo-oa.ts và cron. */
import { prisma } from "./db";
import { audit } from "./audit";

const ZALO_ENV = ["ZALO_OA_APP_ID", "ZALO_OA_SECRET", "ZALO_OA_ACCESS_TOKEN", "ZALO_OA_REFRESH_TOKEN", "ZALO_WEBHOOK_SECRET"] as const;
const REFRESH_URL = "https://oauth.zaloapp.com/v4/oa/access_token";
const SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const LOCK_KEY = "zaloRefreshLock";

export function isZaloSimulated(): boolean {
  return ZALO_ENV.some((k) => !process.env[k]);
}

// ---- Có thể thay thế trong test ----
type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
let sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sleep = (ms: number) => sleepImpl(ms);
export function __setZaloTestHooks(h: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> }) {
  if (h.fetch) fetchImpl = h.fetch;
  if (h.sleep) sleepImpl = h.sleep;
}

export class TokenInvalidError extends Error {}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

async function seedTokenFromEnv() {
  const at = process.env.ZALO_OA_ACCESS_TOKEN;
  const rt = process.env.ZALO_OA_REFRESH_TOKEN;
  if (!at || !rt) return null;
  return prisma.zaloToken.upsert({
    where: { id: 1 },
    create: { id: 1, accessToken: at, refreshToken: rt, expiresAt: new Date(Date.now() + 60 * 60_000) },
    update: {},
  });
}

let inflight: Promise<string> | null = null;

async function acquireLock(): Promise<boolean> {
  const now = Date.now();
  await prisma.appSetting.upsert({ where: { key: LOCK_KEY }, create: { key: LOCK_KEY, value: "0000000000000" }, update: {} });
  // So sánh chuỗi 13 chữ số epoch-ms: nguyên tử ở mức câu lệnh UPDATE của SQLite.
  const r = await prisma.appSetting.updateMany({
    where: { key: LOCK_KEY, value: { lt: String(now).padStart(13, "0") } },
    data: { value: String(now + 60_000).padStart(13, "0") },
  });
  return r.count === 1;
}

async function releaseLock() {
  await prisma.appSetting.update({ where: { key: LOCK_KEY }, data: { value: "0000000000000" } }).catch(() => {});
}

/**
 * Refresh token: mỗi refresh token chỉ dùng được 1 lần. Gộp lời gọi đồng thời trong tiến trình (singleflight)
 * và khóa liên tiến trình bằng AppSetting.
 */
export function refreshZaloToken(force = false): Promise<string> {
  inflight ??= doRefresh(force).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doRefresh(force: boolean): Promise<string> {
  const current = (await prisma.zaloToken.findUnique({ where: { id: 1 } })) ?? (await seedTokenFromEnv());
  if (!current) throw new Error("Chưa có token Zalo trong DB");
  if (!force && current.expiresAt.getTime() - Date.now() > 60 * 60_000) return current.accessToken;

  if (!(await acquireLock())) {
    // Tiến trình khác đang refresh: chờ rồi đọc lại.
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const t = await prisma.zaloToken.findUnique({ where: { id: 1 } });
      if (t && t.refreshToken !== current.refreshToken) return t.accessToken;
    }
    throw new Error("Hết thời gian chờ refresh token Zalo");
  }
  try {
    // Đọc lại SAU khi giữ khóa: tiến trình khác có thể vừa refresh xong (refresh token chỉ dùng 1 lần).
    const fresh = await prisma.zaloToken.findUnique({ where: { id: 1 } });
    if (fresh && fresh.refreshToken !== current.refreshToken) return fresh.accessToken;
    const body = new URLSearchParams({
      refresh_token: current.refreshToken,
      app_id: process.env.ZALO_OA_APP_ID ?? "",
      grant_type: "refresh_token",
    });
    const res = await fetchImpl(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: process.env.ZALO_OA_SECRET ?? "" },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000), // ngắn hơn thời hạn khóa 60 giây
    });
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: string | number; error?: number; message?: string };
    if (!res.ok || !j.access_token || !j.refresh_token) {
      throw new Error(`Refresh thất bại: ${j.error ?? res.status} ${j.message ?? ""}`.trim());
    }
    const expiresIn = Number(j.expires_in ?? 90000);
    // Lưu cặp token mới NGAY, có điều kiện theo refresh token cũ (compare-and-swap).
    const upd = await prisma.zaloToken.updateMany({
      where: { id: 1, refreshToken: current.refreshToken },
      data: { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + expiresIn * 1000) },
    });
    if (upd.count === 0) {
      const t = await prisma.zaloToken.findUniqueOrThrow({ where: { id: 1 } });
      return t.accessToken;
    }
    await prisma.appSetting.deleteMany({ where: { key: "zaloRefreshError" } });
    return j.access_token;
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[zalo] refresh token lỗi:", msg);
    await prisma.appSetting.upsert({
      where: { key: "zaloRefreshError" },
      create: { key: "zaloRefreshError", value: JSON.stringify({ at: new Date().toISOString(), msg }) },
      update: { value: JSON.stringify({ at: new Date().toISOString(), msg }) },
    });
    await audit({ action: "ZALO_TOKEN_REFRESH_FAILED", entity: "ZaloToken", entityId: 1, detail: { msg } });
    throw e;
  } finally {
    await releaseLock();
  }
}

export async function getAccessToken(): Promise<string> {
  const t = (await prisma.zaloToken.findUnique({ where: { id: 1 } })) ?? (await seedTokenFromEnv());
  if (!t) throw new Error("Chưa có token Zalo");
  if (t.expiresAt.getTime() - Date.now() < 60 * 60_000) return refreshZaloToken();
  return t.accessToken;
}

export async function getZaloRefreshError(): Promise<{ at: string; msg: string } | null> {
  const r = await prisma.appSetting.findUnique({ where: { key: "zaloRefreshError" } });
  try {
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transport — tách riêng để đổi sang tin giao dịch / ZNS mà không sửa nghiệp vụ
// ---------------------------------------------------------------------------

export type Transport = (args: { zaloUserId: string; text: string; accessToken: string }) => Promise<void>;

const INVALID_TOKEN_CODES = new Set([-216, -124, -220]);

export const csTransport: Transport = async ({ zaloUserId, text, accessToken }) => {
  const res = await fetchImpl(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: accessToken },
    body: JSON.stringify({ recipient: { user_id: zaloUserId }, message: { text } }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
  if (j.error && INVALID_TOKEN_CODES.has(j.error)) throw new TokenInvalidError(j.message ?? "token không hợp lệ");
  if (!res.ok || (j.error && j.error !== 0)) throw new Error(`Zalo lỗi ${j.error ?? res.status}: ${j.message ?? ""}`);
};

let transportImpl: Transport = csTransport;
export const transport: Transport = (a) => transportImpl(a);
export function setZaloTransport(t: Transport) {
  transportImpl = t;
}

// ---- Tin nhắn nhóm GMF (nhóm chat do OA quản lý — cần OA Doanh nghiệp) ----
// Tài liệu: https://developers.zalo.me/docs/official-account/nhom-chat-gmf/tin-nhan/condition
// Cần xác minh endpoint/payload với tài liệu Zalo hiện hành trước khi chạy thật.
const GROUP_SEND_URL = "https://openapi.zalo.me/v3.0/oa/group/message";

export type GroupTransport = (args: { groupId: string; text: string; accessToken: string }) => Promise<void>;

export const gmfTransport: GroupTransport = async ({ groupId, text, accessToken }) => {
  const res = await fetchImpl(GROUP_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: accessToken },
    body: JSON.stringify({ recipient: { group_id: groupId }, message: { text } }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
  if (j.error && INVALID_TOKEN_CODES.has(j.error)) throw new TokenInvalidError(j.message ?? "token không hợp lệ");
  if (!res.ok || (j.error && j.error !== 0)) throw new Error(`Zalo nhóm lỗi ${j.error ?? res.status}: ${j.message ?? ""}`);
};

let groupTransportImpl: GroupTransport = gmfTransport;
export const groupTransport: GroupTransport = (a) => groupTransportImpl(a);
export function setZaloGroupTransport(t: GroupTransport) {
  groupTransportImpl = t;
}
