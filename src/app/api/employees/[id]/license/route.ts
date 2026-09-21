import { prisma } from "@/lib/db";
import { handle, idParam, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { announce, onceKey } from "@/lib/announce";
import { credentialProfile, loadCredentialTarget } from "@/lib/credential-access";
import { LICENSE_STATUS_LABEL, MEDINET_URL, licenseSchema } from "@/lib/credentials";

/** Hồ sơ hành nghề của một nhân viên: GPHN, văn bằng / chứng chỉ / CME, tiến độ CME, cảnh báo. Nhân sự / Quản trị và chính chủ. */
export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "read");
  const profile = await credentialProfile(e.id, !!e.jobTitle?.requiresLicense);
  const canEdit = await loadCredentialTarget(u, e.id, "write").then(() => true, () => false);
  return json({ employee: { id: e.id, code: e.code, name: e.name, jobTitle: e.jobTitle?.name ?? null }, ...profile, medinetUrl: MEDINET_URL, canEdit });
});

/** Tạo / cập nhật GPHN (có số thì bắt buộc đủ ngày cấp, nơi cấp, đối tượng, phạm vi, tình trạng). */
export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const body = await parseJson(req, licenseSchema);
  const before = await prisma.practiceLicense.findUnique({ where: { employeeId: e.id } });
  const data = {
    number: body.number,
    issuedAt: body.issuedAt,
    issuer: body.issuer,
    subject: body.subject,
    scope: body.scope,
    status: body.status,
    expiresAt: body.expiresAt ?? null,
    renewedAt: body.renewedAt ?? null,
    // Mốc chu kỳ CME: HR nhập riêng, không thì theo ngày gia hạn gần nhất / ngày cấp.
    cmeCycleStart: body.cmeCycleStart ?? body.renewedAt ?? body.issuedAt,
    workplaceNote: body.workplaceNote ?? null,
    // Đổi số GPHN → lần đối chiếu medinet cũ không còn giá trị.
    ...(before && before.number !== body.number ? { verifiedAt: null, verifiedById: null } : {}),
  };
  const license = await prisma.practiceLicense.upsert({ where: { employeeId: e.id }, create: { employeeId: e.id, ...data }, update: data });
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "PracticeLicense", entityId: e.id, detail: { number: data.number, status: data.status, before: before ? { number: before.number, status: before.status } : null } });
  // GPHN không còn "Hoạt động" → báo ngay nhóm minh bạch (không chờ job hằng ngày).
  if (data.status !== "ACTIVE" && before?.status !== data.status) {
    await announce(u, `đã ghi nhận GPHN của ${e.code} — ${e.name}: ${LICENSE_STATUS_LABEL[data.status]}`, {
      key: onceKey("license-status", e.id),
      detail: `Số GPHN ${data.number} · ${data.subject}`,
      always: true,
    });
  }
  return json({ license });
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const del = await prisma.practiceLicense.deleteMany({ where: { employeeId: e.id } });
  if (del.count) await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "PracticeLicense", entityId: e.id, detail: { deleted: true } });
  return json({ ok: true });
});
