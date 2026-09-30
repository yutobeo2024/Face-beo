import { handle, json } from "@/lib/api";
import { requireDevice } from "@/lib/kiosk-auth";
import { getSettings } from "@/lib/settings";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { KIOSK_API_VERSION } from "@/lib/kiosk-auth";

export const GET = handle(async (req) => {
  const d = await requireDevice(req);
  const s = await getSettings();
  return json({
    ok: true,
    device: { id: d.id, name: d.name, location: d.location },
    serverTime: new Date().toISOString(),
    livenessThreshold: s.livenessThreshold,
    // Chế độ chờ (v1.21.0): kiosk đọc lại mỗi lần ping nên đổi trong Cấu hình là có hiệu lực trong 20 giây.
    kiosk: { idleSeconds: s.kioskIdleSeconds, awakeSeconds: s.kioskAwakeSeconds },
    // Kiosk tải lại trang khi giá trị này đổi (deploy bản mới / đổi mô hình).
    apiVersion: `${KIOSK_API_VERSION}:${FACE_MODEL_VERSION}`,
  });
});
