import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { shiftSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { requirePerm } from "@/lib/permissions";

export const GET = handle(async (req) => {
  await requireUser(req);
  const shifts = await prisma.shift.findMany({ orderBy: { startTime: "asc" } });
  return json({ shifts });
});

export const POST = handle(async (req) => {
  const u = await requirePerm(req, "org.manage");
  const body = await parseJson(req, shiftSchema);
  if (body.startTime === body.endTime) throw badRequest("Giờ bắt đầu và kết thúc không được trùng nhau");
  if (await prisma.shift.findUnique({ where: { name: body.name } })) throw badRequest("Tên ca đã tồn tại");
  const s = await prisma.shift.create({ data: body });
  await audit({ actorId: u.id, action: "SHIFT_UPDATE", entity: "Shift", entityId: s.id, detail: body });
  return json({ shift: s }, { status: 201 });
});
