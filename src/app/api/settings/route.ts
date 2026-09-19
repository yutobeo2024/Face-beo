import { handle, json, parseJson } from "@/lib/api";
import { getSettings, getStringSetting, saveSettings, saveStringSetting, settingsSchema } from "@/lib/settings";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { isZaloSimulated } from "@/lib/zalo-token";
import { env } from "@/lib/env";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { l2Status } from "@/lib/liveness-l2";
import { requirePerm } from "@/lib/permissions";

export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  return json({
    settings: await getSettings(),
    zaloGroupId: await getStringSetting("zaloGroupId"),
    system: { zaloSimulated: isZaloSimulated(), livenessServer: env.livenessServer, l2: l2Status(), faceModelVersion: FACE_MODEL_VERSION },
  });
});

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  const { zaloGroupId, ...body } = await parseJson(req, settingsSchema.partial().extend({ zaloGroupId: z.string().trim().max(100).optional() }));
  const before = await getSettings();
  await saveSettings(body);
  if (zaloGroupId !== undefined) await saveStringSetting("zaloGroupId", zaloGroupId);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "AppSetting", detail: { before, after: body, zaloGroupId } });
  return json({ settings: await getSettings() });
});
