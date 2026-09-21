import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadCredentialTarget } from "@/lib/credential-access";

/** Nhân sự đã đối chiếu GPHN trên medinet (tra tay) — ghi thời điểm và người đối chiếu. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const upd = await prisma.practiceLicense.updateMany({ where: { employeeId: e.id }, data: { verifiedAt: new Date(), verifiedById: u.id } });
  if (!upd.count) throw badRequest("Chưa có GPHN để đối chiếu");
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "PracticeLicense", entityId: e.id, detail: { verified: true } });
  return json({ ok: true });
});
