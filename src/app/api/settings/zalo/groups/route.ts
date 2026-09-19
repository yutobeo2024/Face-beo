import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { getStringSetting, saveStringSetting } from "@/lib/settings";
import { getAccessToken, getGroupInfo, isZaloSimulated } from "@/lib/zalo-token";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";

/** Danh sách nhóm GMF đã dò được (webhook create_group) hoặc đã nhập; ở chế độ thật làm mới tên/trạng thái qua API getgroup. */
export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  const connected = (await getStringSetting("zaloGroupId")).trim();
  const groups = await prisma.zaloGroup.findMany({ orderBy: { discoveredAt: "desc" }, take: 20 });
  if (!isZaloSimulated() && groups.length) {
    try {
      const at = await getAccessToken();
      for (const g of groups) {
        try {
          const info = await getGroupInfo(at, g.groupId);
          Object.assign(g, await prisma.zaloGroup.update({ where: { groupId: g.groupId }, data: { name: info.name, status: info.status, totalMember: info.totalMember } }));
        } catch (e) {
          Object.assign(g, await prisma.zaloGroup.update({ where: { groupId: g.groupId }, data: { status: `lỗi: ${(e as Error).message.slice(0, 120)}` } }));
        }
      }
    } catch {
      /* không có token — giữ dữ liệu đã lưu */
    }
  }
  return json({ connected, groups });
});

/**
 * Kết nối nhóm: đặt AppSetting zaloGroupId = groupId (nhập tay hoặc chọn từ danh sách đã dò).
 * Chế độ thật: xác minh bằng getgroup (phải tồn tại và enabled) rồi gửi một tin xác nhận vào nhóm.
 */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  const { groupId } = await parseJson(req, z.object({ groupId: z.string().trim().min(4).max(100) }));
  let info: { name: string; status: string; totalMember: number } | null = null;
  if (!isZaloSimulated()) {
    try {
      info = await getGroupInfo(await getAccessToken(), groupId);
    } catch (e) {
      throw badRequest(`Không lấy được thông tin nhóm: ${(e as Error).message}`);
    }
    if (info.status !== "enabled") throw badRequest(`Nhóm đang ở trạng thái "${info.status}" — OA không gửi tin được`);
  }
  await prisma.zaloGroup.upsert({
    where: { groupId },
    create: { groupId, source: "MANUAL", name: info?.name, status: info?.status, totalMember: info?.totalMember },
    update: { name: info?.name ?? undefined, status: info?.status ?? undefined, totalMember: info?.totalMember ?? undefined },
  });
  const before = await getStringSetting("zaloGroupId");
  await saveStringSetting("zaloGroupId", groupId);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "AppSetting", detail: { zaloGroupId: groupId, before, groupName: info?.name } });
  await announce(u, `đã KẾT NỐI nhóm Zalo này làm nhóm minh bạch của Face Beo`, {
    key: `zalo-connect:${groupId}:${Date.now()}`,
    detail: "Từ giờ mọi thao tác duyệt/sửa của Nhân sự và Quản trị sẽ được báo vào đây.",
    always: true,
  });
  return json({ ok: true, groupId, group: info });
});
