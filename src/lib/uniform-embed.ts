/**
 * Đặc trưng hình ảnh của vùng áo bằng mô hình ONNX (v1.20.0).
 *
 * Đây là tín hiệu PHỤ, bổ sung cho màu và logo: mô hình bắt được hoa văn, kiểu cổ áo, hình dáng logo.
 * Toàn bộ tính năng vẫn chạy được khi KHÔNG có mô hình (chỉ còn màu + logo, kết quả thận trọng hơn) — nên thiếu
 * tệp `.onnx` không bao giờ làm hỏng việc chấm công.
 *
 * Khác với mô hình khuôn mặt (thường trú, 167 MB), mô hình này NẠP RỒI GIẢI PHÓNG theo từng lượt job:
 * container chỉ có 1,5 GB và mô hình khuôn mặt đã chiếm phần lớn. Xem `withUniformModel`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InferenceSession } from "onnxruntime-node";

/** Phiên bản ghi kèm mỗi mẫu áo: đổi mô hình ⇒ phải tính lại mẫu, không so lẫn lộn hai phiên bản. */
export const UNIFORM_MODEL_VERSION = process.env.UNIFORM_MODEL_VERSION || "uniform-v1";
/** Cạnh ảnh mô hình đòi. MobileCLIP-S0 (mô hình mặc định) dùng 256×256, ảnh chỉ chia 255 — không chuẩn hóa mean/std. */
export const UNIFORM_INPUT_SIZE = Number(process.env.UNIFORM_INPUT_SIZE) || 256;

export const uniformModelPath = () => process.env.UNIFORM_MODEL_PATH || join(process.cwd(), "models", "uniform.onnx");

export type UniformEmbedHook = (rgb: Uint8Array, size: number) => Float32Array | null;
const g = globalThis as unknown as { __uniformHook?: UniformEmbedHook | null; __uniformError?: string | null };

/** Chỉ dùng trong test: thay mô hình bằng hàm giả (không cần tệp .onnx). */
export function __setUniformEmbedTestHook(hook: UniformEmbedHook | null) {
  g.__uniformHook = hook;
  if (hook) g.__uniformError = null;
}

export function uniformModelStatus() {
  const path = uniformModelPath();
  return {
    version: UNIFORM_MODEL_VERSION,
    modelPath: path,
    modelExists: existsSync(path),
    hooked: !!g.__uniformHook,
    error: g.__uniformError ?? null,
  };
}

export type UniformEmbedder = {
  /** Trả vector đặc trưng đã chuẩn hóa, hoặc null nếu mô hình không dùng được. */
  embed(rgb: Uint8Array, size: number): Promise<Float32Array | null>;
  available: boolean;
};

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (!n) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Mở mô hình, chạy `fn`, rồi GIẢI PHÓNG. Gọi một lần cho cả lô ảnh của một lượt job.
 * Không có mô hình (hoặc nạp lỗi) thì vẫn gọi `fn` với `available: false` — nơi gọi tự xoay sang màu + logo.
 */
export async function withUniformModel<T>(fn: (m: UniformEmbedder) => Promise<T>): Promise<T> {
  const hook = g.__uniformHook;
  if (hook) {
    return fn({ available: true, embed: async (rgb, size) => (hook(rgb, size) ? normalize(hook(rgb, size)!) : null) });
  }

  const path = uniformModelPath();
  if (!existsSync(path)) {
    g.__uniformError = `Chưa có mô hình tại ${path} — chạy "npm run models:uniform"`;
    return fn({ available: false, embed: async () => null });
  }

  let session: InferenceSession | null = null;
  try {
    const ort = await import("onnxruntime-node");
    session = await ort.InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: 1 });
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    g.__uniformError = null;

    const embedder: UniformEmbedder = {
      available: true,
      async embed(rgb, size) {
        try {
          const data = new Float32Array(3 * size * size);
          // NCHW, giá trị 0…1 (chuẩn hóa mean/std nếu mô hình đòi thì sửa tại đây, nhớ áp cho cả ảnh mẫu).
          for (let i = 0; i < size * size; i++) {
            data[i] = rgb[i * 3] / 255;
            data[size * size + i] = rgb[i * 3 + 1] / 255;
            data[2 * size * size + i] = rgb[i * 3 + 2] / 255;
          }
          const ort2 = await import("onnxruntime-node");
          const out = await session!.run({ [inputName]: new ort2.Tensor("float32", data, [1, 3, size, size]) });
          const raw = out[outputName].data as Float32Array;
          return normalize(Float32Array.from(raw));
        } catch (e) {
          g.__uniformError = (e as Error).message;
          return null;
        }
      },
    };
    return await fn(embedder);
  } catch (e) {
    g.__uniformError = (e as Error).message;
    return fn({ available: false, embed: async () => null });
  } finally {
    // Trả RAM ngay: mô hình khuôn mặt (167 MB) vẫn thường trú, container chỉ có 1,5 GB.
    await session?.release().catch(() => {});
  }
}
