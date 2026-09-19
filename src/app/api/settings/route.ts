import { handle, json, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getSettings, saveSettings, settingsSchema } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { isZaloSimulated } from "@/lib/zalo-token";
import { env } from "@/lib/env";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { l2Status } from "@/lib/liveness-l2";

export const GET = handle(async (req) => {
  await requireUser(req, ["ADMIN"]);
  return json({
    settings: await getSettings(),
    system: { zaloSimulated: isZaloSimulated(), livenessServer: env.livenessServer, l2: l2Status(), faceModelVersion: FACE_MODEL_VERSION },
  });
});

export const PUT = handle(async (req) => {
  const u = await requireUser(req, ["ADMIN"]);
  const body = await parseJson(req, settingsSchema.partial());
  const before = await getSettings();
  await saveSettings(body);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "AppSetting", detail: { before, after: body } });
  return json({ settings: await getSettings() });
});
