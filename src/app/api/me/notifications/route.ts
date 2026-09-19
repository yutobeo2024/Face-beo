import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";

/** Thông báo gần đây của tôi (kể cả tin SKIPPED_NO_ZALO khi chưa liên kết Zalo). */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const rows = await prisma.notificationLog.findMany({
    where: { toEmployeeId: u.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, messageType: true, payload: true, status: true, createdAt: true },
  });
  return json({
    notifications: rows.map((r) => {
      let text = "";
      try {
        text = JSON.parse(r.payload).text ?? "";
      } catch {}
      return { id: r.id, messageType: r.messageType, status: r.status, createdAt: r.createdAt, text };
    }),
  });
});
