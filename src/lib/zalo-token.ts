/** Token Zalo OA (lưu DB, tự refresh có khóa) và transport gửi tin. Dùng nội bộ bởi zalo-oa.ts và cron. */
import { prisma } from "./db";
import { audit } from "./audit";

const REFRESH_URL = "https://oauth.zaloapp.com/v4/oa/access_token";
const SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const OA_INFO_URL = "https://openapi.zalo.me/v3.0/oa/getoa";
const LOCK_KEY = "zaloRefreshLock";

/** Đã thấy token trong DB (nạp lúc khởi động hoặc lần đầu dùng) — để công tắc mô phỏng không phụ thuộc token trong .env. */
// Next.js có thể nạp module này nhiều bản (instrumentation, từng route) => lưu trên globalThis để mọi bản thấy cùng giá trị.
const gz = globalThis as unknown as { __zaloDbTokenKnown?: boolean };
const setDbTokenKnown = (v: boolean) => {
  gz.__zaloDbTokenKnown = v;
};

/**
 * Mô phỏng khi thiếu App ID / Secret, hoặc chưa có token nào (cả .env lẫn DB).
 * ZALO_WEBHOOK_SECRET KHÔNG ảnh hưởng công tắc này — chỉ webhook cần nó.
 */
export function isZaloSimulated(): boolean {
  if (!process.env.ZALO_OA_APP_ID || !process.env.ZALO_OA_SECRET) return true;
  return !process.env.ZALO_OA_REFRESH_TOKEN && !gz.__zaloDbTokenKnown;
}

/** Gọi lúc khởi động: kiểm tra DB đã có token chưa (bật chế độ thật kể cả khi .env không còn token). */
export async function primeZaloToken(): Promise<boolean> {
  const t = await prisma.zaloToken.findUnique({ where: { id: 1 } }).catch(() => null);
  setDbTokenKnown(!!t);
  return !!t;
}

/** Lỗi API Zalo có mã; `retryable` = nên thử lại (quá tải, hạn mức tạm thời), ngược lại là lỗi cấu hình / dữ liệu. */
export class ZaloApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}
/** Mã lỗi tạm thời theo tài liệu OA API (quá nhiều request / hệ thống bận). */
// Chỉ -32 (vượt giới hạn tần suất) là tạm thời; -201 (tham số không hợp lệ), -210 (vượt giới hạn tham số)… là lỗi yêu cầu — thử lại vô ích.
const RETRYABLE_CODES = new Set([-32]);

/** Đọc JSON trả về của OA API và ném lỗi có phân loại. */
function checkZaloResponse(res: { ok: boolean; status: number }, j: { error?: number; message?: string }, what: string): void {
  // Phản hồi không có trường error dạng số (trang HTML của proxy, JSON hỏng…) => KHÔNG coi là thành công.
  if (typeof j.error !== "number") throw new ZaloApiError(`Zalo ${what}: phản hồi không hợp lệ (HTTP ${res.status})`, res.status, true);
  const code = j.error;
  if (code && INVALID_TOKEN_CODES.has(code)) throw new TokenInvalidError(j.message ?? "token không hợp lệ");
  if (code !== 0) throw new ZaloApiError(`Zalo ${what} lỗi ${code}: ${j.message ?? ""}`.trim(), code, RETRYABLE_CODES.has(code));
  if (!res.ok) throw new ZaloApiError(`Zalo ${what} HTTP ${res.status}`, res.status, res.status >= 500 || res.status === 429);
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
  if (!rt) return null;
  // Chỉ có refresh token: đặt hết hạn ngay để lần dùng đầu tự refresh. Access token Zalo hiệu lực 25 giờ.
  const row = await prisma.zaloToken.upsert({
    where: { id: 1 },
    create: { id: 1, accessToken: at ?? "", refreshToken: rt, expiresAt: at ? new Date(Date.now() + 60 * 60_000) : new Date(0) },
    update: {},
  });
  setDbTokenKnown(true);
  return row;
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
  setDbTokenKnown(true);
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
  setDbTokenKnown(true);
  if (t.expiresAt.getTime() - Date.now() < 60 * 60_000) return refreshZaloToken();
  return t.accessToken;
}

/** Trạng thái token để hiển thị ở Cấu hình (không lộ giá trị token). */
export async function getZaloTokenStatus() {
  const t = await prisma.zaloToken.findUnique({ where: { id: 1 }, select: { expiresAt: true, updatedAt: true } });
  return t ? { exists: true, expiresAt: t.expiresAt, updatedAt: t.updatedAt } : { exists: false, expiresAt: null, updatedAt: null };
}

/** Thông tin OA (tên, id) — kiểm tra token có gọi API được không. */
export async function getOaInfo(accessToken: string): Promise<{ oaId: string; name: string }> {
  const res = await fetchImpl(OA_INFO_URL, { method: "GET", headers: { access_token: accessToken } });
  const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { oa_id?: string | number; name?: string } };
  checkZaloResponse(res, j, "getoa");
  return { oaId: String(j.data?.oa_id ?? ""), name: j.data?.name ?? "" };
}

/** Thông tin nhóm GMF: tên, trạng thái (enabled = OA gửi tin được), số thành viên. */
export async function getGroupInfo(accessToken: string, groupId: string): Promise<{ name: string; status: string; totalMember: number; link: string }> {
  const res = await fetchImpl(`${GROUP_INFO_URL}?group_id=${encodeURIComponent(groupId)}`, { method: "GET", headers: { access_token: accessToken } });
  const j = (await res.json().catch(() => ({}))) as {
    error?: number;
    message?: string;
    data?: { group_info?: { name?: string; status?: string; total_member?: number; group_link?: string } };
  };
  checkZaloResponse(res, j, "getgroup");
  const g = j.data?.group_info ?? {};
  return { name: g.name ?? "", status: g.status ?? "", totalMember: Number(g.total_member ?? 0), link: g.group_link ?? "" };
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
  checkZaloResponse(res, j, "tin tư vấn");
};

let transportImpl: Transport = csTransport;
export const transport: Transport = (a) => transportImpl(a);
export function setZaloTransport(t: Transport) {
  transportImpl = t;
}

// ---- Tin nhắn nhóm GMF (nhóm chat do OA quản lý — cần OA có gói dịch vụ) ----
// Đã đối chiếu tài liệu 19/09/2026: POST /v3.0/oa/group/message, body {recipient:{group_id}, message:{text}},
// trả {data:{message_id, group_id}, error:0}. App phải được cấp quyền "Gửi tin nhắn" và "Quản lý Nhóm Chat - GMF".
const GROUP_SEND_URL = "https://openapi.zalo.me/v3.0/oa/group/message";
const GROUP_INFO_URL = "https://openapi.zalo.me/v3.0/oa/group/getgroup";

export type GroupTransport = (args: { groupId: string; text: string; accessToken: string }) => Promise<void>;

export const gmfTransport: GroupTransport = async ({ groupId, text, accessToken }) => {
  const res = await fetchImpl(GROUP_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: accessToken },
    body: JSON.stringify({ recipient: { group_id: groupId }, message: { text } }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
  checkZaloResponse(res, j, "tin nhóm");
};

let groupTransportImpl: GroupTransport = gmfTransport;
export const groupTransport: GroupTransport = (a) => groupTransportImpl(a);
export function setZaloGroupTransport(t: GroupTransport) {
  groupTransportImpl = t;
}
