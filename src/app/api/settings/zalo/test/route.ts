import { handle, json } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { announce } from "@/lib/announce";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/api";

/** Gửi một tin thử vào nhóm Zalo minh bạch (chỉ Quản trị). Trả trạng thái và lỗi (mã lỗi Zalo nếu có). */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  if (!rateLimit(`zalo-test:${u.id}`, 5).ok) throw new HttpError(429, "Tối đa 5 tin thử mỗi phút");
  const key = `zalo-test:${Date.now()}`;
  await announce(u, "gửi TIN THỬ từ Face Beo", { key, detail: "Nếu bạn thấy tin này trong nhóm thì cấu hình Zalo OA đã đúng.", always: true });
  const row = await prisma.notificationLog.findUnique({ where: { dedupeKey: `grp:${key}` }, select: { status: true, error: true } });
  return json({ status: row?.status ?? "ERROR", error: row?.error ?? (row ? null : "Không ghi được nhật ký") });
});
