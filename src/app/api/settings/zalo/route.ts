import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { env } from "@/lib/env";
import { getAccessToken, getOaInfo, getZaloRefreshError, getZaloTokenStatus, isZaloSimulated } from "@/lib/zalo-token";

/**
 * Trạng thái Zalo OA cho Cấu hình → Zalo (chỉ Quản trị): chế độ, biến môi trường, token, OA, 10 tin nhóm gần nhất (kèm tên nhóm).
 * Danh sách nhóm và loại tin nhận: GET /api/settings/zalo/groups. Gọi API Zalo thật (getoa) khi ở chế độ thật — lỗi được trả về dạng chuỗi, không ném.
 */
export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  const simulated = isZaloSimulated();
  const [token, refreshError, recent] = await Promise.all([
    getZaloTokenStatus(),
    getZaloRefreshError(),
    prisma.notificationLog.findMany({
      where: { toGroupId: { not: null } },
      orderBy: { id: "desc" },
      take: 10,
      select: { id: true, createdAt: true, status: true, error: true, messageType: true, payload: true, toGroupId: true },
    }),
  ]);
  const names = new Map(
    (await prisma.zaloGroup.findMany({ where: { groupId: { in: [...new Set(recent.map((r) => r.toGroupId!))] } }, select: { groupId: true, name: true } })).map((g) => [g.groupId, g.name]),
  );
  let oa: { oaId: string; name: string } | null = null;
  let oaError: string | null = null;
  if (!simulated) {
    try {
      const at = await getAccessToken();
      try {
        oa = await getOaInfo(at);
      } catch (e) {
        oaError = (e as Error).message;
      }
    } catch (e) {
      oaError = (e as Error).message;
    }
  }
  return json({
    simulated,
    env: {
      appId: !!process.env.ZALO_OA_APP_ID,
      secret: !!process.env.ZALO_OA_SECRET,
      refreshTokenEnv: !!process.env.ZALO_OA_REFRESH_TOKEN,
      webhookSecret: !!process.env.ZALO_WEBHOOK_SECRET,
      appBaseUrl: env.appBaseUrl,
    },
    token,
    refreshError,
    oa,
    oaError,
    recent: recent.map((r) => {
      let text = "";
      try {
        text = String((JSON.parse(r.payload) as { text?: string }).text ?? "");
      } catch {
        /* payload cũ */
      }
      return { id: r.id, at: r.createdAt, status: r.status, error: r.error, type: r.messageType, text: text.slice(0, 160), group: names.get(r.toGroupId!) || r.toGroupId };
    }),
  });
});
