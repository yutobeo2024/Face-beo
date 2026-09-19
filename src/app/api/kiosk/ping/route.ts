import { handle, json } from "@/lib/api";
import { requireDevice } from "@/lib/kiosk-auth";
import { getSettings } from "@/lib/settings";

export const GET = handle(async (req) => {
  const d = await requireDevice(req);
  const s = await getSettings();
  return json({
    ok: true,
    device: { id: d.id, name: d.name, location: d.location },
    serverTime: new Date().toISOString(),
    livenessThreshold: s.livenessThreshold,
  });
});
