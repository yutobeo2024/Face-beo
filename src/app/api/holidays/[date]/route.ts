import { prisma } from "@/lib/db";
import { badRequest, handle, json, notFound, parseJson } from "@/lib/api";
import { dateStr, holidayPatchSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

/**
 * Sửa ngày lễ. Ngày là khóa chính nên đổi ngày = xóa dòng cũ + tạo dòng mới trong một giao dịch.
 * Tên chỉ để hiển thị; đổi NGÀY làm thay đổi cách tính công của tháng chưa chốt ở cả ngày cũ lẫn ngày mới (tháng đã chốt giữ nguyên).
 */
export const PATCH = handle<{ date: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const date = dateStr.parse((await ctx.params).date);
  const body = await parseJson(req, holidayPatchSchema);
  const cur = await prisma.holiday.findUnique({ where: { date } });
  if (!cur) throw notFound();
  const nextDate = body.date ?? date;
  const name = body.name ?? cur.name;
  if (nextDate !== date && (await prisma.holiday.findUnique({ where: { date: nextDate } }))) throw badRequest("Ngày này đã là ngày lễ");
  const h =
    nextDate === date
      ? await prisma.holiday.update({ where: { date }, data: { name } })
      : (await prisma.$transaction([prisma.holiday.delete({ where: { date } }), prisma.holiday.create({ data: { date: nextDate, name } })]))[1];
  await audit({ actorId: u.id, action: "HOLIDAY_UPDATE", entity: "Holiday", entityId: h.date, detail: { from: date, to: nextDate, name } });
  return json({ holiday: h });
});

export const DELETE = handle<{ date: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const date = dateStr.parse((await ctx.params).date);
  await prisma.holiday.deleteMany({ where: { date } });
  await audit({ actorId: u.id, action: "HOLIDAY_UPDATE", entity: "Holiday", entityId: date, detail: { deleted: true } });
  return json({ ok: true });
});
