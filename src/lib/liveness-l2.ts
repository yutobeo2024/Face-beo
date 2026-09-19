/**
 * Lớp L2 chống giả mạo phía server (PRD mục 6): MiniFASNetV2 (Silent-Face-Anti-Spoofing, Apache-2.0)
 * chạy bằng onnxruntime-node trên vùng mặt cắt từ snapshot.
 *
 * Tiền xử lý khớp mã tham chiếu (yakhyo/face-anti-spoofing, onnx_inference.py):
 *  - cắt vùng quanh khung mặt với hệ số 2.7 (giới hạn trong ảnh), resize bilinear kiểu OpenCV về input (80×80)
 *  - thứ tự kênh BGR, giá trị pixel 0–255 dạng float32, KHÔNG chuẩn hóa, bố cục NCHW
 *  - đầu ra 3 lớp logits → softmax; lớp 1 = mặt thật (0 = giả mạo 2D, 2 = giả mạo 3D)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InferenceSession } from "onnxruntime-node";

export const MINIFASNET_SCALE = 2.7;
export const REAL_CLASS = 1;

export type FaceBox = [number, number, number, number]; // x, y, w, h (pixel của snapshot)

export function modelPath() {
  return process.env.LIVENESS_MODEL_PATH || join(process.cwd(), "models", "MiniFASNetV2.onnx");
}

/** Vùng cắt theo đúng công thức `_crop_face` của mã tham chiếu. Trả về toạ độ nguyên, bao gồm cả biên. */
export function cropRegion(srcW: number, srcH: number, box: FaceBox, scaleWanted = MINIFASNET_SCALE) {
  const [x, y, bw, bh] = box.map((v) => Math.trunc(v)) as FaceBox;
  if (bw <= 0 || bh <= 0) throw new Error("Khung mặt không hợp lệ");
  const scale = Math.min((srcH - 1) / bh, (srcW - 1) / bw, scaleWanted);
  const newW = bw * scale;
  const newH = bh * scale;
  const cx = x + bw / 2;
  const cy = y + bh / 2;
  const x1 = Math.max(0, Math.trunc(cx - newW / 2));
  const y1 = Math.max(0, Math.trunc(cy - newH / 2));
  const x2 = Math.min(srcW - 1, Math.trunc(cx + newW / 2));
  const y2 = Math.min(srcH - 1, Math.trunc(cy + newH / 2));
  return { left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}

/**
 * Resize bilinear khớp cv2.resize(INTER_LINEAR) — mô hình được huấn luyện với phép này. Khi thu nhỏ, OpenCV
 * KHÔNG khử răng cưa (chỉ lấy 4 điểm lân cận, ánh xạ tâm pixel), khác bộ lọc của sharp/libvips; dùng sharp
 * làm lệch xác suất "thật" tới hàng chục điểm %. Đầu vào/đầu ra: RGB xen kẽ uint8, kết quả làm tròn như uint8.
 */
export function resizeBilinearCV(src: Uint8Array, sw: number, sh: number, dw: number, dh: number, ch = 3): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    let fy = (dy + 0.5) * sy - 0.5;
    let y0 = Math.floor(fy);
    fy -= y0;
    if (y0 < 0) {
      y0 = 0;
      fy = 0;
    }
    if (y0 >= sh - 1) {
      y0 = sh - 1;
      fy = 0;
    }
    const y1 = Math.min(y0 + 1, sh - 1);
    for (let dx = 0; dx < dw; dx++) {
      let fx = (dx + 0.5) * sx - 0.5;
      let x0 = Math.floor(fx);
      fx -= x0;
      if (x0 < 0) {
        x0 = 0;
        fx = 0;
      }
      if (x0 >= sw - 1) {
        x0 = sw - 1;
        fx = 0;
      }
      const x1 = Math.min(x0 + 1, sw - 1);
      for (let c = 0; c < ch; c++) {
        const v00 = src[(y0 * sw + x0) * ch + c];
        const v01 = src[(y0 * sw + x1) * ch + c];
        const v10 = src[(y1 * sw + x0) * ch + c];
        const v11 = src[(y1 * sw + x1) * ch + c];
        const v = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
        out[(dy * dw + dx) * ch + c] = Math.min(255, Math.max(0, Math.round(v)));
      }
    }
  }
  return out;
}

/** JPEG + khung mặt → tensor NCHW BGR float32 (0–255). */
export async function preprocess(jpeg: Buffer, box: FaceBox, size: [number, number]): Promise<Float32Array> {
  const { default: sharp } = await import("sharp");
  const img = sharp(jpeg, { failOn: "error", limitInputPixels: 1920 * 1080 });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Không đọc được kích thước snapshot");
  const region = cropRegion(meta.width, meta.height, box);
  const [H, W] = size;
  const { data, info } = await img.extract(region).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const rgb = resizeBilinearCV(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, W, H, info.channels);
  const plane = H * W;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = rgb[i * 3 + 2]; // B
    out[plane + i] = rgb[i * 3 + 1]; // G
    out[2 * plane + i] = rgb[i * 3]; // R
  }
  return out;
}

export function softmax(logits: ArrayLike<number>): number[] {
  const max = Math.max(...Array.from(logits));
  const e = Array.from(logits, (v) => Math.exp(v - max));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

type Engine = { session: InferenceSession; size: [number, number]; input: string; output: string };
const g = globalThis as unknown as { __l2Engine?: Promise<Engine> | null; __l2Error?: string | null };

/** Nạp mô hình một lần cho mỗi tiến trình (dùng globalThis vì Next đóng gói route riêng rẽ). */
export function loadL2(): Promise<Engine> {
  g.__l2Engine ??= (async () => {
    const path = modelPath();
    if (!existsSync(path)) throw new Error(`Không tìm thấy mô hình L2 tại ${path} — chạy "npm run models:liveness"`);
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    const input = session.inputNames[0];
    const output = session.outputNames[0];
    const meta = session.inputMetadata[0] as unknown as { shape?: (number | string)[] };
    const shape = meta?.shape ?? [];
    const size: [number, number] = [Number(shape[2]) || 80, Number(shape[3]) || 80];
    g.__l2Error = null;
    return { session, size, input, output };
  })().catch((e) => {
    g.__l2Engine = null;
    g.__l2Error = (e as Error).message;
    throw e;
  });
  return g.__l2Engine;
}

export function l2Status() {
  return { modelPath: modelPath(), modelExists: existsSync(modelPath()), error: g.__l2Error ?? null };
}

/** Xác suất "mặt thật" của MiniFASNetV2 trên vùng mặt của snapshot. */
export async function miniFasnetScore(jpeg: Buffer, box: FaceBox): Promise<{ real: number; probs: number[]; ms: number }> {
  const t0 = performance.now();
  const eng = await loadL2();
  const ort = await import("onnxruntime-node");
  const data = await preprocess(jpeg, box, eng.size);
  const tensor = new ort.Tensor("float32", data, [1, 3, eng.size[0], eng.size[1]]);
  const res = await eng.session.run({ [eng.input]: tensor });
  const probs = softmax(res[eng.output].data as Float32Array);
  return { real: probs[REAL_CLASS] ?? 0, probs, ms: Math.round(performance.now() - t0) };
}
