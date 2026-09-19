// Khởi động phía Node: bật WAL, nạp template khuôn mặt vào bộ nhớ, lên lịch cron.
import { ensureDb } from "./lib/db";
import { getTemplates } from "./lib/face-matcher";
import { startCron } from "./lib/cron";

await ensureDb().catch((e) => console.error("[boot] không bật được WAL:", e.message));
getTemplates()
  .then((t) => console.log(`[boot] đã nạp ${t.length} template khuôn mặt`))
  .catch((e) => console.error("[boot] nạp template lỗi:", e.message));
if (process.env.DISABLE_CRON !== "true" && process.env.NEXT_PHASE !== "phase-production-build") {
  startCron();
}

// Lớp L2: nạp sẵn MiniFASNetV2 để lượt quét đầu không bị chậm; lỗi chỉ ghi log (quét vẫn dùng L1 + cảnh báo ADMIN).
if (process.env.LIVENESS_SERVER === "true") {
  import("./lib/liveness-l2")
    .then(async ({ loadL2, modelPath }) => {
      const e = await loadL2();
      console.log(`[boot] L2 liveness sẵn sàng: ${modelPath()} (input ${e.size.join("×")})`);
    })
    .catch((e) => console.error("[boot] L2 liveness KHÔNG sẵn sàng:", e.message));
}

// Nhận diện khuôn mặt (InsightFace, ONNX): nạp sẵn để lượt quét đầu không chậm; thiếu mô hình => kiosk trả 503, cần chạy `npm run models:face`.
import("./lib/face-embed")
  .then(async ({ loadFaceModel, faceModelStatus }) => {
    await loadFaceModel();
    const s = faceModelStatus();
    console.log(`[boot] Nhận diện khuôn mặt sẵn sàng: ${s.label} (${s.modelPath})`);
  })
  .catch((e) => console.error("[boot] Nhận diện khuôn mặt KHÔNG sẵn sàng:", e.message));

// Zalo OA: biết DB đã có token chưa để bật chế độ gửi thật (token trong .env chỉ dùng khởi tạo).
import("./lib/zalo-token")
  .then(async ({ primeZaloToken, isZaloSimulated }) => {
    await primeZaloToken();
    console.log(`[boot] Zalo OA: ${isZaloSimulated() ? "MÔ PHỎNG (thiếu App ID / Secret / token)" : "gửi thật"}`);
  })
  .catch((e) => console.error("[boot] Zalo OA:", e.message));
