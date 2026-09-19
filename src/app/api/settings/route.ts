import { handle, json, parseJson } from "@/lib/api";
import { getSettings, getStringSetting, saveSettings, settingsSchema } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { isZaloSimulated } from "@/lib/zalo-token";
import { env } from "@/lib/env";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { l2Status } from "@/lib/liveness-l2";
import { faceModelStatus } from "@/lib/face-embed";
import { requirePerm } from "@/lib/permissions";

export const GET = handle(async (req) => {
  await requirePerm(req, "settings.system");
  return json({
    settings: await getSettings(),
    zaloGroupId: await getStringSetting("zaloGroupId"),
    system: { zaloSimulated: isZaloSimulated(), livenessServer: env.livenessServer, l2: l2Status(), faceModelVersion: FACE_MODEL_VERSION, face: faceModelStatus() },
  });
});

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "settings.system");
  // ID nhóm Zalo KHÔNG đổi ở đây — chỉ qua POST /api/settings/zalo/groups (xác minh nhóm enabled trước khi lưu).
  const body = await parseJson(req, settingsSchema.partial());
  const before = await getSettings();
  await saveSettings(body);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "AppSetting", detail: { before, after: body } });
  return json({ settings: await getSettings() });
});
