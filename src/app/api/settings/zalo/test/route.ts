import { z } from "zod";
import { badRequest, handle, json, notFound } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { announce } from "@/lib/announce";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/api";
import { sendZaloMessage } from "@/lib/zalo-oa";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { nowText } from "@/lib/zalo-routing";

/**
 * Gửi một tin thử (chỉ Quản trị): có `groupId` → vào đúng nhóm đó; không có → vào các nhóm nhận tin minh bạch.
 * Trả trạng thái và lỗi (mã lỗi Zalo nếu có).
 */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  if (!rateLimit(`zalo-test:${u.id}`, 5).ok) throw new HttpError(429, "Tối đa 5 tin thử mỗi phút");
  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest("Body JSON không hợp lệ");
    }
  }
  // Không gửi body (giao diện cũ) → vào các nhóm minh bạch; có groupId → đúng nhóm đó.
  const body = z.object({ groupId: z.string().trim().min(1).max(100).optional() }).parse(parsed);
  const key = `zalo-test:${Date.now()}`;
  let row: { status: string; error: string | null } | null;
  if (body.groupId) {
    if (!(await prisma.zaloGroup.findUnique({ where: { groupId: body.groupId } }))) throw notFound("Không có nhóm này");
    const r = await sendZaloMessage({
      toGroupId: body.groupId,
      messageType: "GROUP_EVENT",
      dedupeKey: `grp:${key}`,
      data: {
        actorRole: ROLE_LABEL[u.role as Role] ?? u.role,
        actorName: u.name,
        action: "gửi TIN THỬ từ Face Beo",
        detail: "Nếu bạn thấy tin này trong nhóm thì cấu hình Zalo OA đã đúng.",
        atText: nowText(),
      },
    });
    row = r.id ? await prisma.notificationLog.findUnique({ where: { id: r.id }, select: { status: true, error: true } }) : null;
  } else {
    await announce(u, "gửi TIN THỬ từ Face Beo", { key, detail: "Nếu bạn thấy tin này trong nhóm thì cấu hình Zalo OA đã đúng.", always: true });
    row = await prisma.notificationLog.findFirst({ where: { dedupeKey: { startsWith: `grp:${key}` } }, orderBy: { id: "desc" }, select: { status: true, error: true } });
  }
  return json({ status: row?.status ?? "ERROR", error: row?.error ?? (row ? null : "Không ghi được nhật ký") });
});
