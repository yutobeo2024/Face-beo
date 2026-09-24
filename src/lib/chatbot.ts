/**
 * Chat bot tra cứu y khoa (v1.17.0) — Face Beo là cửa DUY NHẤT vào chat bot.
 *
 * Ai được dùng: bật theo phòng (`Department.chatbotEnabled`), từng người đặt riêng được
 * (`Employee.chatbotEnabled`: null = theo phòng, true = được dùng, false = cấm) — cùng kiểu với "không chấm công".
 * Trình duyệt KHÔNG bao giờ thấy địa chỉ hay khóa của chat bot: mọi lượt hỏi đi qua máy chủ Face Beo,
 * gọi sang chat bot trong mạng nội bộ của VPS kèm khóa `X-Chat-Key`.
 * Nội dung hỏi đáp KHÔNG được lưu ở máy chủ — chỉ đếm số lượt (bảng ChatbotUsage) để chặn lạm dụng.
 */
import { prisma } from "./db";
import { rewriteImagePaths, rewriteImageUrl } from "./client/chatbot-text";
import { badRequest, forbidden, HttpError } from "./api";
import { todayVN } from "./attendance";
import type { AuthUser } from "./auth";

export const CHAT_PER_MINUTE = 10;
export const CHAT_PER_DAY = 100;
/** Ảnh đính kèm: tối đa 3 tấm, mỗi tấm ≤ 10 MB và cả lượt hỏi ≤ 12 MB (giữ bộ nhớ máy chủ, nó chỉ có 1 GB). */
export const MAX_ATTACHMENTS = 3;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
/** Số ký tự base64 tương ứng một dung lượng (base64 phình 4/3). */
export const base64Chars = (bytes: number) => Math.ceil((bytes * 4) / 3);

/** Kết quả: được dùng hay không, và do cấu hình của người hay của phòng. */
export function chatbotInfo(e: { chatbotEnabled: boolean | null; department: { chatbotEnabled: boolean } }) {
  if (e.chatbotEnabled !== null && e.chatbotEnabled !== undefined) return { allowed: e.chatbotEnabled, source: "EMPLOYEE" as const };
  return { allowed: e.department.chatbotEnabled, source: "DEPARTMENT" as const };
}

/** Người đang đăng nhập có được dùng chat bot không (một truy vấn). */
export async function chatbotAllowed(u: Pick<AuthUser, "id">): Promise<boolean> {
  const e = await prisma.employee.findUnique({ where: { id: u.id }, select: { chatbotEnabled: true, department: { select: { chatbotEnabled: true } } } });
  return !!e && chatbotInfo(e).allowed;
}

export async function assertChatbotAllowed(u: Pick<AuthUser, "id">) {
  if (!(await chatbotAllowed(u))) throw forbidden("Tài khoản của bạn chưa được cấp quyền dùng Chat bot — liên hệ Nhân sự hoặc Quản trị.");
}

/** Số lượt hỏi trong ngày (giờ VN) của một người. */
export async function usageToday(employeeId: number): Promise<number> {
  const row = await prisma.chatbotUsage.findUnique({ where: { employeeId_day: { employeeId, day: todayVN() } }, select: { count: true } });
  return row?.count ?? 0;
}

/** Ghi thêm một lượt hỏi (chỉ số đếm, không nội dung). Trả về tổng lượt trong ngày sau khi cộng. */
export async function bumpUsage(employeeId: number, day = todayVN()): Promise<number> {
  const row = await prisma.chatbotUsage.upsert({
    where: { employeeId_day: { employeeId, day } },
    create: { employeeId, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}

export async function assertUnderDailyLimit(employeeId: number) {
  if ((await usageToday(employeeId)) >= CHAT_PER_DAY) throw dailyLimitError();
}

const dailyLimitError = () => new HttpError(429, `Bạn đã hỏi ${CHAT_PER_DAY} câu hôm nay — mức tối đa mỗi ngày. Mai hỏi tiếp nhé.`);

/**
 * Giữ chỗ một lượt hỏi: cộng số đếm TRƯỚC khi gọi chat bot rồi mới hỏi. Kiểm xong mới cộng (kiểu cũ) thì mở
 * nhiều tab hỏi cùng lúc sẽ lọt vài câu quá mức ngày. Hỏi hỏng → gọi `refund()` trả lại lượt.
 */
export async function takeDailySlot(employeeId: number): Promise<{ used: number; refund: () => Promise<void> }> {
  // Ghim NGÀY lúc giữ chỗ: câu hỏi bắt đầu lúc 23:59:50 mà hỏng lúc 00:00:05 thì phải trả lại lượt của ngày hôm qua,
  // không được trừ vào hạn mức của ngày mới.
  const day = todayVN();
  const used = await bumpUsage(employeeId, day);
  if (used > CHAT_PER_DAY) {
    await releaseUsage(employeeId, day);
    throw dailyLimitError();
  }
  let done = false;
  return {
    used,
    refund: async () => {
      if (done) return;
      done = true;
      await releaseUsage(employeeId, day);
    },
  };
}

/** Trả lại một lượt của đúng ngày đã giữ chỗ (không cho âm). */
async function releaseUsage(employeeId: number, day: string) {
  await prisma.chatbotUsage.updateMany({ where: { employeeId, day, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

// ---------------------------------------------------------------------------------------------------------------
// Gọi sang chat bot (mạng nội bộ VPS). Tách hàm fetch ra để test tiêm bản giả — KHÔNG gọi mạng thật khi chạy test.
type FetchResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: { get: (k: string) => string | null };
  /** Chỉ dùng cho câu trả lời theo luồng (SSE). */
  body?: ReadableStream<Uint8Array> | null;
};
type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponseLike>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
export function __setChatbotTestHooks(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
}

const baseUrl = () => (process.env.CHATBOT_API_URL || "").replace(/\/+$/, "");
export const chatbotConfigured = () => !!baseUrl();

function headers(json = false): Record<string, string> {
  const key = process.env.CHATBOT_API_KEY;
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(key ? { "X-Chat-Key": key } : {}) };
}

export type ChatAsk = {
  message: string;
  attachments: { data: string; mime_type: string }[];
  history: { role: "user" | "ai"; content: string }[];
};
export type ChatReply = { reply_text: string; sources: { source_type: string; title: string; image_url: string }[] };

/** Ảnh minh họa trong câu trả lời nằm ở chat bot (`/static/...`) — đổi sang đường của Face Beo (có kiểm quyền).
 *  Hàm thuần nằm ở `src/lib/client/chatbot-text.ts` vì trang chat cũng cần khi nhận chữ theo luồng. */
export { IMAGE_PROXY_PREFIX, rewriteImagePaths, rewriteImageUrl } from "./client/chatbot-text";

/** Hỏi chat bot. Lỗi mạng / chat bot chết → thông báo tiếng Việt, không lộ địa chỉ nội bộ. */
export async function askChatbot(body: ChatAsk): Promise<ChatReply> {
  if (!chatbotConfigured()) throw new HttpError(503, "Chat bot chưa được cấu hình trên máy chủ — báo Quản trị.");
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${baseUrl()}/api/v1/chat`, { method: "POST", headers: headers(true), body: JSON.stringify(body) });
  } catch {
    throw new HttpError(502, "Không gọi được Chat bot (máy chủ chat bot đang tắt?). Thử lại sau ít phút.");
  }
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, "Chat bot đang bận, chờ một chút rồi hỏi lại nhé.");
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Chat bot từ chối khóa truy cập — báo Quản trị kiểm tra cấu hình.");
    if (res.status === 422) throw badRequest("Câu hỏi quá dài hoặc ảnh quá lớn — rút gọn rồi gửi lại.");
    throw new HttpError(502, "Chat bot trả lời lỗi. Thử lại sau ít phút.");
  }
  let data: Partial<ChatReply>;
  try {
    data = (await res.json()) as Partial<ChatReply>;
  } catch {
    throw new HttpError(502, "Chat bot trả lời lỗi. Thử lại sau ít phút.");
  }
  const sources = Array.isArray(data.sources) ? data.sources.filter((s) => s && typeof s === "object").slice(0, 20) : [];
  return {
    reply_text: rewriteImagePaths(String(data.reply_text ?? "")),
    sources: sources.map((s) => ({ ...s, image_url: typeof s.image_url === "string" ? rewriteImageUrl(s.image_url) : "" })),
  };
}

/** Chỉ nhận đúng vài loại ảnh; chat bot trả về SVG/HTML thì coi như hỏng (tránh chạy mã lạ trong trình duyệt). */
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif)$/i;

/**
 * Hỏi chat bot theo LUỒNG: trả về đúng thân phản hồi SSE của chat bot để route chuyển thẳng cho trình duyệt.
 * Gemini viết một câu dài mất cả phút, nên chữ phải hiện dần thay vì chờ xong hết.
 * Chat bot đời cũ chưa có đường này (404) → `null` để nơi gọi quay về cách hỏi một lần.
 */
export async function askChatbotStream(body: ChatAsk): Promise<ReadableStream<Uint8Array> | null> {
  if (!chatbotConfigured()) throw new HttpError(503, "Chat bot chưa được cấu hình trên máy chủ — báo Quản trị.");
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${baseUrl()}/api/v1/chat/stream`, { method: "POST", headers: headers(true), body: JSON.stringify(body) });
  } catch {
    throw new HttpError(502, "Không gọi được Chat bot (máy chủ chat bot đang tắt?). Thử lại sau ít phút.");
  }
  if (res.status === 404 || res.status === 405) return null; // chat bot chưa hỗ trợ luồng
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, "Chat bot đang bận, chờ một chút rồi hỏi lại nhé.");
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Chat bot từ chối khóa truy cập — báo Quản trị kiểm tra cấu hình.");
    if (res.status === 422) throw badRequest("Câu hỏi quá dài hoặc ảnh quá lớn — rút gọn rồi gửi lại.");
    throw new HttpError(502, "Chat bot trả lời lỗi. Thử lại sau ít phút.");
  }
  return res.body ?? null;
}

/** Tải ảnh minh họa từ chat bot. Đường dẫn phải sạch (chỉ chữ / số / . _ - /), cấm "." và "..". */
export async function fetchChatbotImage(path: string): Promise<{ body: ArrayBuffer; type: string }> {
  const parts = path.split("/");
  const clean =
    path.length <= 300 &&
    parts.length <= 8 &&
    parts.every((p) => p.length > 0 && p !== "." && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p));
  if (!clean) throw badRequest("Đường dẫn ảnh không hợp lệ");
  if (!chatbotConfigured()) throw new HttpError(503, "Chat bot chưa được cấu hình trên máy chủ");
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${baseUrl()}/static/${path}`, { method: "GET", headers: headers() });
  } catch {
    throw new HttpError(502, "Không tải được ảnh minh họa");
  }
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, "Không tải được ảnh minh họa");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES.test(type)) throw new HttpError(502, "Không tải được ảnh minh họa");
  return { body: await res.arrayBuffer(), type };
}
