import { z } from "zod";
import { handle, json, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { getSettings, getStringSetting, saveSettings, saveStringSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/** Cấu hình tự tra cứu medinet (v1.11.0): bật/tắt, số ngày giữa 2 lần tra, số GPHĐ của phòng khám (nhận biết "nơi khác"). */
const read = async () => {
  const s = await getSettings();
  return { medinetAutoCheck: s.medinetAutoCheck, medinetCheckDays: s.medinetCheckDays, clinicFacilityLicenses: await getStringSetting("clinicFacilityLicenses") };
};

export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  return json(await read());
});

// PATCH-kiểu: không .default() — trường không gửi giữ nguyên.
const body = z.object({
  medinetAutoCheck: z.union([z.literal(0), z.literal(1)]).optional(),
  medinetCheckDays: z.number().int().min(7).max(365).optional(),
  clinicFacilityLicenses: z.string().trim().max(300).optional(),
});

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  const b = await parseJson(req, body);
  const before = await read();
  const nums: { medinetAutoCheck?: number; medinetCheckDays?: number } = {};
  if (b.medinetAutoCheck !== undefined) nums.medinetAutoCheck = b.medinetAutoCheck;
  if (b.medinetCheckDays !== undefined) nums.medinetCheckDays = b.medinetCheckDays;
  if (Object.keys(nums).length) await saveSettings(nums);
  if (b.clinicFacilityLicenses !== undefined) {
    const clean = b.clinicFacilityLicenses.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).join(", ");
    await saveStringSetting("clinicFacilityLicenses", clean);
  }
  const after = await read();
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "AppSetting", detail: { medinet: { before, after } } });
  return json(after);
});
