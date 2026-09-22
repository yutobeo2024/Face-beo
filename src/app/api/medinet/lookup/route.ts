import { z } from "zod";
import { forbidden, handle, HttpError, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { canSeePersonal } from "@/lib/employees";
import { rateLimit } from "@/lib/rate-limit";
import { lookupMedinet } from "@/lib/medinet";

/** Tra một số GPHN trên medinet để điền sẵn form nhập GPHN (chưa lưu gì). Nhân sự / Quản trị. */
export const POST = handle(async (req) => {
  const u = await requireUser(req);
  if (!canSeePersonal(u)) throw forbidden();
  if (!rateLimit(`medinet:${u.id}`, 10).ok || !rateLimit("medinet:global", 30).ok) throw new HttpError(429, "Tra cứu quá nhiều, vui lòng chờ một phút");
  const { number } = await parseJson(req, z.object({ number: z.string().trim().min(3).max(60) }));
  const r = await lookupMedinet(number);
  if (!r.ok) throw new HttpError(502, r.error);
  return json({ found: !!r.record, record: r.record, candidates: r.candidates });
});
