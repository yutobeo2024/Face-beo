import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ensureDb } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = "Chưa đăng nhập") => new HttpError(401, msg);
export const forbidden = (msg = "Không có quyền") => new HttpError(403, msg);
export const notFound = (msg = "Không tìm thấy") => new HttpError(404, msg);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);

export type RouteCtx<P = Record<string, string>> = { params: Promise<P> };

type Handler<P> = (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;

/** Bọc route handler: bật WAL, chuẩn hóa lỗi thành JSON `{ error }`. */
export function handle<P = Record<string, string>>(fn: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      await ensureDb();
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      }
      if (e instanceof ZodError) {
        const first = e.issues[0];
        return NextResponse.json(
          { error: first ? `${first.path.join(".") || "dữ liệu"}: ${first.message}` : "Dữ liệu không hợp lệ", issues: e.issues },
          { status: 400 },
        );
      }
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
    }
  };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Body JSON không hợp lệ");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export async function idParam(ctx: RouteCtx<{ id: string }>): Promise<number> {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("id không hợp lệ");
  return n;
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * IP client dùng cho giới hạn tần suất. Chỉ tin X-Forwarded-For khi chạy sau reverse proxy tin cậy
 * (TRUSTED_PROXY_HOPS = số proxy phía trước, mặc định 1 cho Caddy/Nginx): lấy phần tử do proxy gần nhất thêm vào
 * (tính từ PHẢI sang), không lấy phần tử đầu mà client tự đặt được.
 * Chạy sau Cloudflare Tunnel (app không lộ cổng nào ra ngoài): đặt CLIENT_IP_HEADER=cf-connecting-ip — header do Cloudflare ghi đè,
 * client không tự đặt được. KHÔNG bật khi app nhận kết nối trực tiếp (ai cũng giả được header).
 */
export function clientIp(req: NextRequest): string {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (header) {
    const ip = req.headers.get(header)?.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const hops = Number(process.env.TRUSTED_PROXY_HOPS || "1"); // để trống trong .env = mặc định
  const xff = req.headers.get("x-forwarded-for");
  if (hops > 0 && xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip;
  }
  return "direct";
}
