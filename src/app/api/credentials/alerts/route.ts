import { forbidden, handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { canSeePersonal } from "@/lib/employees";
import { credentialAlerts } from "@/lib/credential-access";

/** Cảnh báo hồ sơ hành nghề (GPHN, CME, chứng chỉ hết hạn) — thẻ dashboard của Nhân sự / Quản trị. */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  if (!canSeePersonal(u)) throw forbidden();
  return json({ items: await credentialAlerts() });
});
