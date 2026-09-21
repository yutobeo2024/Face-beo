import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { getAccessToken, getGroupInfo, isZaloSimulated } from "@/lib/zalo-token";
import { audit } from "@/lib/audit";
import { sendZaloMessage } from "@/lib/zalo-oa";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { ZALO_CATEGORY_INFO, categoriesSchema, groupCategories, groupDepartmentIds, nowText, parseGroupInput } from "@/lib/zalo-routing";

/** Danh sách nhóm GMF đã dò được / đã nhập, kèm loại tin nhận; ở chế độ thật làm mới tên/trạng thái qua API getgroup. */
export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  const rows = await prisma.zaloGroup.findMany({ orderBy: { discoveredAt: "desc" }, take: 100 });
  const groups = rows.map((g) => ({ ...g, categories: groupCategories(g.categories), departmentIds: groupDepartmentIds(g.departmentIds), error: null as string | null }));
  if (!isZaloSimulated() && groups.length) {
    try {
      const at = await getAccessToken();
      for (const g of groups) {
        try {
          const info = await getGroupInfo(at, g.groupId);
          await prisma.zaloGroup.update({ where: { groupId: g.groupId }, data: { name: info.name, status: info.status, totalMember: info.totalMember } });
          Object.assign(g, { name: info.name, status: info.status, totalMember: info.totalMember });
        } catch (e) {
          // Không ghi đè trạng thái đã lưu (lỗi có thể chỉ là tạm thời) — chỉ báo trong phản hồi.
          g.error = (e as Error).message.slice(0, 160);
        }
      }
    } catch {
      /* không có token — giữ dữ liệu đã lưu */
    }
  }
  // Nhóm đang nhận tin lên đầu.
  groups.sort((a, b) => Number(b.categories.length > 0) - Number(a.categories.length > 0));
  return json({ groups });
});

/**
 * Thêm / kết nối nhóm: nhận ID nhóm hoặc cả link chat OA (`…?gid=…&oaid=…`), kèm loại tin muốn nhận.
 * Chế độ thật: xác minh bằng getgroup (phải tồn tại và enabled) rồi gửi một tin xác nhận vào chính nhóm đó.
 */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  const body = await parseJson(req, z.object({ groupId: z.string().trim().min(4).max(500), categories: categoriesSchema.optional() }));
  const parsed = parseGroupInput(body.groupId);
  if ("error" in parsed) throw badRequest(parsed.error);
  const { groupId } = parsed;
  let info: { name: string; status: string; totalMember: number } | null = null;
  if (!isZaloSimulated()) {
    try {
      info = await getGroupInfo(await getAccessToken(), groupId);
    } catch (e) {
      throw badRequest(`Không lấy được thông tin nhóm: ${(e as Error).message}`);
    }
    if (info.status !== "enabled") throw badRequest(`Nhóm đang ở trạng thái "${info.status}" — OA không gửi tin được`);
  }
  const categories = body.categories ? [...new Set(body.categories)] : undefined;
  const before = await prisma.zaloGroup.findUnique({ where: { groupId } });
  const row = await prisma.zaloGroup.upsert({
    where: { groupId },
    create: { groupId, source: "MANUAL", name: info?.name, status: info?.status, totalMember: info?.totalMember, categories: JSON.stringify(categories ?? []) },
    update: {
      name: info?.name ?? undefined,
      status: info?.status ?? undefined,
      totalMember: info?.totalMember ?? undefined,
      ...(categories && { categories: JSON.stringify(categories) }),
    },
  });
  const cats = groupCategories(row.categories);
  await audit({
    actorId: u.id,
    action: "ZALO_GROUP_ROUTING",
    entity: "ZaloGroup",
    entityId: groupId,
    detail: { connect: true, groupName: info?.name, before: before ? groupCategories(before.categories) : null, categories: cats },
  });
  await sendZaloMessage({
    toGroupId: groupId,
    messageType: "GROUP_EVENT",
    dedupeKey: `grp:zalo-connect:${groupId}:${Date.now()}`,
    data: {
      actorRole: ROLE_LABEL[u.role as Role] ?? u.role,
      actorName: u.name,
      action: "đã KẾT NỐI nhóm Zalo này với Face Beo",
      detail: cats.length ? `Nhóm sẽ nhận: ${cats.map((c) => ZALO_CATEGORY_INFO[c].label).join(", ")}.` : "Chưa chọn loại tin — Quản trị tích loại tin trong Cấu hình → Zalo OA.",
      atText: nowText(),
    },
  });
  return json({ ok: true, groupId, group: info, categories: cats });
});
