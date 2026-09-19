import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { dateStr } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

export const DELETE = handle<{ date: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const date = dateStr.parse((await ctx.params).date);
  await prisma.holiday.deleteMany({ where: { date } });
  await audit({ actorId: u.id, action: "HOLIDAY_UPDATE", entity: "Holiday", entityId: date, detail: { deleted: true } });
  return json({ ok: true });
});
