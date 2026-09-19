import { prisma } from "@/lib/db";
import { handle, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { holidaySchema } from "@/lib/validators";
import { audit } from "@/lib/audit";

export const GET = handle(async (req) => {
  await requireUser(req);
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return json({ holidays });
});

export const POST = handle(async (req) => {
  const u = await requireUser(req, ["ADMIN"]);
  const body = await parseJson(req, holidaySchema);
  const h = await prisma.holiday.upsert({ where: { date: body.date }, create: body, update: { name: body.name } });
  await audit({ actorId: u.id, action: "HOLIDAY_UPDATE", entity: "Holiday", entityId: h.date, detail: body });
  return json({ holiday: h }, { status: 201 });
});
