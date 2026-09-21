import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadCredentialTarget } from "@/lib/credential-access";
import { credentialPatchSchema, dateOrderError } from "@/lib/credentials";
import { deleteCredentialFile } from "@/lib/credential-files";

type P = { id: string; cid: string };

async function load(employeeId: number, cid: string) {
  const id = Number(cid);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("id không hợp lệ");
  const c = await prisma.credential.findUnique({ where: { id } });
  if (!c || c.employeeId !== employeeId) throw notFound();
  return c;
}

export const PATCH = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const c = await load(e.id, (await ctx.params).cid);
  const body = await parseJson(req, credentialPatchSchema);
  const type = body.type ?? c.type;
  const cmeHours = body.cmeHours !== undefined ? body.cmeHours : c.cmeHours;
  const issuedAt = body.issuedAt !== undefined ? body.issuedAt : c.issuedAt;
  if (type === "CME" && (cmeHours == null || issuedAt == null)) throw badRequest("CME cần số tiết và ngày cấp");
  const dateErr = dateOrderError(issuedAt, body.expiresAt !== undefined ? body.expiresAt : c.expiresAt);
  if (dateErr) throw badRequest(dateErr);
  const item = await prisma.credential.update({ where: { id: c.id }, data: { ...body, cmeHours: type === "CME" ? cmeHours : null } });
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "Credential", entityId: c.id, detail: { employeeId: e.id, changed: Object.keys(body) } });
  return json({ item });
});

export const DELETE = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const c = await load(e.id, (await ctx.params).cid);
  await prisma.credential.delete({ where: { id: c.id } });
  await deleteCredentialFile(e.id, c.fileKey);
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "Credential", entityId: c.id, detail: { employeeId: e.id, deleted: c.name } });
  return json({ ok: true });
});
