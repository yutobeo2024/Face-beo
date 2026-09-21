import { prisma } from "@/lib/db";
import { handle, idParam, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadCredentialTarget } from "@/lib/credential-access";
import { credentialSchema } from "@/lib/credentials";

/** Thêm văn bằng / chứng chỉ / CME (file đính kèm tải lên riêng qua .../credentials/[cid]/file). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const body = await parseJson(req, credentialSchema);
  const item = await prisma.credential.create({
    data: {
      employeeId: e.id,
      type: body.type,
      name: body.name,
      issuer: body.issuer ?? null,
      number: body.number ?? null,
      issuedAt: body.issuedAt ?? null,
      expiresAt: body.expiresAt ?? null,
      cmeHours: body.type === "CME" ? (body.cmeHours ?? null) : null,
      createdById: u.id,
    },
  });
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "Credential", entityId: item.id, detail: { employeeId: e.id, type: item.type, name: item.name } });
  return json({ item }, { status: 201 });
});
