import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, notFound, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import { ZALO_CATEGORY_INFO, categoriesSchema, groupCategories, groupDepartmentIds, nowText } from "@/lib/zalo-routing";
import { sendZaloMessage } from "@/lib/zalo-oa";
import { ROLE_LABEL, type Role } from "@/lib/roles";

// PATCH: không dùng .default() (luật zod 4 của dự án) — trường không gửi thì giữ nguyên.
const patchSchema = z.object({
  categories: categoriesSchema.optional(),
  departmentIds: z.array(z.number().int().positive()).max(200).optional(),
});

/** Đổi loại tin nhóm nhận và phòng ban áp dụng (tin nhân viên). Mảng loại tin rỗng = nhóm ngừng nhận tin. */
export const PATCH = handle<{ groupId: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "settings.system");
  const { groupId } = await ctx.params;
  const body = await parseJson(req, patchSchema);
  const row = await prisma.zaloGroup.findUnique({ where: { groupId } });
  if (!row) throw notFound("Không có nhóm này — thêm nhóm trước");
  const categories = body.categories ? [...new Set(body.categories)] : groupCategories(row.categories);
  const wanted = body.departmentIds ? [...new Set(body.departmentIds)] : groupDepartmentIds(row.departmentIds);
  // Phòng đã bị xóa thì lặng lẽ bỏ khỏi danh sách (không chặn lưu — giao diện không còn hiện phòng đó để gỡ).
  const existing = wanted.length ? new Set((await prisma.department.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((d) => d.id)) : new Set<number>();
  if (body.departmentIds && body.departmentIds.length && !body.departmentIds.some((id) => existing.has(id))) throw badRequest("Phòng ban không tồn tại");
  const departmentIds = wanted.filter((id) => existing.has(id)).sort((a, b) => a - b);
  const before = { categories: groupCategories(row.categories), departmentIds: groupDepartmentIds(row.departmentIds) };
  await prisma.zaloGroup.update({ where: { groupId }, data: { categories: JSON.stringify(categories), departmentIds: JSON.stringify(departmentIds) } });
  await audit({ actorId: u.id, action: "ZALO_GROUP_ROUTING", entity: "ZaloGroup", entityId: groupId, detail: { before, after: { categories, departmentIds } } });

  const deptNames = departmentIds.length ? (await prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { name: true } })).map((d) => d.name).join(", ") : "mọi phòng";
  const label = (cs: string[]) => (cs.length ? cs.map((c) => ZALO_CATEGORY_INFO[c as keyof typeof ZALO_CATEGORY_INFO]?.label ?? c).join(", ") : "không nhận tin");
  await announce(u, `đã đổi loại tin của nhóm Zalo "${row.name ?? groupId}"`, {
    key: `zalo-routing:${groupId}:${Date.now()}`,
    detail: `Trước: ${label(before.categories)}\nSau: ${label(categories)}${categories.some((c) => c !== "MINH_BACH") ? ` — phòng: ${deptNames}` : ""}`,
    always: true,
  });
  return json({ ok: true, groupId, categories, departmentIds });
});

/**
 * Xóa nhóm khỏi danh sách nhận tin (v1.15.0): báo vào chính nhóm đó rồi gỡ khỏi DB — từ đó không gửi gì nữa.
 * Nhật ký tin đã gửi (NotificationLog) giữ nguyên. Nếu nhóm nhắn cho OA lần nữa, webhook `create_group` sẽ thêm lại
 * nhóm với danh sách loại tin RỖNG (không nhận tin) cho tới khi Quản trị tích lại — đúng ý "hiện lại nhưng không nhận tin".
 */
export const DELETE = handle<{ groupId: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "settings.system");
  const { groupId } = await ctx.params;
  const row = await prisma.zaloGroup.findUnique({ where: { groupId } });
  if (!row) throw notFound("Không có nhóm này");
  const categories = groupCategories(row.categories);
  const name = row.name ?? groupId;
  // Xóa TRƯỚC rồi mới báo: hai lượt xóa cùng lúc (bấm đúp, hai Quản trị) thì chỉ một lượt có count → lượt kia 404 thay vì 500,
  // và nhóm chỉ nhận đúng MỘT tin chia tay. sendZaloMessage không đọc bảng ZaloGroup nên xóa rồi vẫn gửi được.
  const gone = await prisma.zaloGroup.deleteMany({ where: { groupId } });
  if (!gone.count) throw notFound("Không có nhóm này");
  await sendZaloMessage({
    toGroupId: groupId,
    messageType: "GROUP_EVENT",
    dedupeKey: `grp:zalo-disconnect:${groupId}:${Date.now()}`,
    data: {
      actorRole: ROLE_LABEL[u.role as Role] ?? u.role,
      actorName: u.name,
      action: "đã NGỪNG gửi tin Face Beo vào nhóm này",
      detail: "Nhóm đã được gỡ khỏi danh sách nhận tin trong Cấu hình → Zalo OA.",
      atText: nowText(),
    },
  });
  await audit({ actorId: u.id, action: "ZALO_GROUP_ROUTING", entity: "ZaloGroup", entityId: groupId, detail: { deleted: true, groupName: row.name, categories } });
  await announce(u, `đã xóa nhóm Zalo "${name}" khỏi danh sách nhận tin`, {
    key: `zalo-delete:${groupId}:${Date.now()}`,
    detail: categories.length ? `Nhóm này đang nhận: ${categories.map((c) => ZALO_CATEGORY_INFO[c as keyof typeof ZALO_CATEGORY_INFO]?.label ?? c).join(", ")} — từ nay không nhận nữa.` : "Nhóm này vốn không nhận tin nào.",
    always: true,
  });
  return json({ ok: true, groupId });
});
