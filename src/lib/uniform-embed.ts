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
export const UNIFORM_MODEL_VERSION = process.env.UNIFORM_MODEL_VERSION || "dinov2s-v1";
/** Cạnh ảnh mô hình đòi. DINOv2-small (mô hình mặc định) dùng 224×224. */
export const UNIFORM_INPUT_SIZE = Number(process.env.UNIFORM_INPUT_SIZE) || 224;
/**
 * Chuẩn hóa ảnh theo ImageNet — DINOv2 được huấn luyện với mức này, bỏ đi thì vector lệch hẳn.
 * Đổi sang mô hình chỉ cần chia 255 thì đặt UNIFORM_MODEL_MEAN="0,0,0" và UNIFORM_MODEL_STD="1,1,1".
 */
const triple = (raw: string | undefined, fallback: [number, number, number]): [number, number, number] => {
  const v = (raw ?? "").split(",").map(Number);
  return v.length === 3 && v.every((x) => Number.isFinite(x)) ? (v as [number, number, number]) : fallback;
};
export const UNIFORM_MEAN = triple(process.env.UNIFORM_MODEL_MEAN, [0.485, 0.456, 0.406]);
export const UNIFORM_STD = triple(process.env.UNIFORM_MODEL_STD, [0.229, 0.224, 0.225]);

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

/**
 * Gộp đầu ra về MỘT vector.
 *
 * Mô hình kiểu ViT (DINOv2) trả [1, số ô, số chiều]: lấy TRUNG BÌNH các ô ảnh (bỏ ô đầu là ô tổng hợp) —
 * đo thực tế trên ảnh đồng phục thật, cách này tách đúng/sai áo tốt hơn dùng riêng ô tổng hợp.
 * Mô hình trả thẳng [1, số chiều] thì giữ nguyên.
 */
function pool(raw: Float32Array, dims: readonly number[]): Float32Array {
  if (dims.length !== 3) return Float32Array.from(raw);
  const [, tokens, d] = dims;
  if (tokens <= 1) return Float32Array.from(raw.slice(0, d));
  const out = new Float32Array(d);
  for (let t = 1; t < tokens; t++) for (let k = 0; k < d; k++) out[k] += raw[t * d + k] / (tokens - 1);
  return out;
}

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
          const n = size * size;
          const data = new Float32Array(3 * n);
          // NCHW, giá trị (0…1 − mean) / std. Ảnh mẫu đi qua CÙNG hàm này nên luôn cùng một hệ quy chiếu.
          for (let i = 0; i < n; i++) {
            data[i] = (rgb[i * 3] / 255 - UNIFORM_MEAN[0]) / UNIFORM_STD[0];
            data[n + i] = (rgb[i * 3 + 1] / 255 - UNIFORM_MEAN[1]) / UNIFORM_STD[1];
            data[2 * n + i] = (rgb[i * 3 + 2] / 255 - UNIFORM_MEAN[2]) / UNIFORM_STD[2];
          }
          const ort2 = await import("onnxruntime-node");
          const out = await session!.run({ [inputName]: new ort2.Tensor("float32", data, [1, 3, size, size]) });
          return normalize(pool(out[outputName].data as Float32Array, out[outputName].dims as readonly number[]));
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
