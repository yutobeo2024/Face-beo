import { handle, HttpError, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { credentialProfile, loadCredentialTarget } from "@/lib/credential-access";
import { checkLicenseOnMedinet } from "@/lib/medinet-check";
import { MEDINET_URL } from "@/lib/credentials";

/** "Tra cứu tự động": đối chiếu GPHN đã lưu của nhân viên với medinet ngay (Nhân sự / Quản trị). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  if (!rateLimit(`medinet:${u.id}`, 10).ok || !rateLimit("medinet:global", 30).ok) throw new HttpError(429, "Tra cứu quá nhiều, vui lòng chờ một phút");
  const result = await checkLicenseOnMedinet(e.id, u.id);
  if (!result) throw notFound("Chưa có GPHN để tra cứu");
  const profile = await credentialProfile(e.id, !!e.jobTitle?.requiresLicense);
  return json({ result, ...profile, medinetUrl: MEDINET_URL, canEdit: true });
});
