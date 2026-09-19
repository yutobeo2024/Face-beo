/**
 * Nhận diện khuôn mặt phía server (v1.3): InsightFace ArcFace (buffalo_l/w600k_r50 hoặc buffalo_sc/w600k_mbf, MIT)
 * chạy bằng onnxruntime-node.
 *
 * Kiosk / trang enroll chỉ phát hiện mặt và gửi snapshot + 5 điểm mốc (mắt trái, mắt phải, mũi, khóe miệng trái, phải).
 * Server căn chỉnh mặt theo mẫu ArcFace 112×112 (phép biến đổi tương tự ước lượng từ 5 điểm), chuẩn hóa (x−127.5)/127.5,
 * RGB, bố cục NCHW, rồi lấy embedding 512 chiều (đã chuẩn hóa L2). So khớp bằng cosine trong face-matcher.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InferenceSession } from "onnxruntime-node";

export type Pt = [number, number];
export type Landmarks5 = [Pt, Pt, Pt, Pt, Pt];

export const FACE_SIZE = 112;
export const EMBED_DIM = 512;

/** 5 điểm chuẩn ArcFace trên ảnh 112×112 (InsightFace `arcface_dst`). */
export const ARCFACE_TEMPLATE: Landmarks5 = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export const FACE_MODELS = {
  r50: { file: "w600k_r50.onnx", version: "insightface-w600k_r50-v1", label: "InsightFace ResNet50 (buffalo_l)" },
  mbf: { file: "w600k_mbf.onnx", version: "insightface-w600k_mbf-v1", label: "InsightFace MobileFaceNet (buffalo_sc)" },
} as const;
export type FaceModelKey = keyof typeof FACE_MODELS;

export function faceModelKey(): FaceModelKey {
  const k = process.env.FACE_EMBED_MODEL;
  return k === "mbf" ? "mbf" : "r50";
}

export function faceModelPath() {
  return process.env.FACE_MODEL_PATH || join(process.cwd(), "models", FACE_MODELS[faceModelKey()].file);
}

/**
 * Ước lượng phép biến đổi tương tự (xoay + tỉ lệ + tịnh tiến) dst ≈ s·R·src + t (Umeyama 2D, không phản chiếu).
 * Trả về ma trận 2×2 `A` và vector tịnh tiến `t`: [x'; y'] = A·[x; y] + t.
 */
export function similarityTransform(src: Pt[], dst: Pt[]): { A: [[number, number], [number, number]]; t: Pt } {
  const n = src.length;
  if (n < 2 || dst.length !== n) throw new Error("Cần ít nhất 2 cặp điểm");
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[i][0] / n; msy += src[i][1] / n; mdx += dst[i][0] / n; mdy += dst[i][1] / n;
  }
  let sxx = 0, sxy = 0, syx = 0, syy = 0, varS = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - msx, y = src[i][1] - msy, u = dst[i][0] - mdx, v = dst[i][1] - mdy;
    sxx += u * x; sxy += u * y; syx += v * x; syy += v * y; varS += x * x + y * y;
  }
  if (varS === 0) throw new Error("Các điểm nguồn trùng nhau");
  // Ma trận xoay tối ưu cho phép tương tự 2D: góc θ = atan2(syx − sxy, sxx + syy).
  const a = sxx + syy, b = syx - sxy;
  const norm = Math.hypot(a, b);
  if (norm === 0) throw new Error("Không ước lượng được phép xoay");
  const cos = a / norm, sin = b / norm;
  const s = norm / varS;
  const A: [[number, number], [number, number]] = [[s * cos, -s * sin], [s * sin, s * cos]];
  return { A, t: [mdx - (A[0][0] * msx + A[0][1] * msy), mdy - (A[1][0] * msx + A[1][1] * msy)] };
}

/**
 * Căn chỉnh mặt: warp ảnh RGB `raw` (W×H, 3 kênh) về 112×112 theo 5 điểm mốc (ánh xạ ngược + nội suy song tuyến tính,
 * ngoài ảnh = đen). Trả về tensor NCHW float32 đã chuẩn hóa (x−127.5)/127.5.
 */
export function alignFace(raw: Uint8Array, W: number, H: number, pts: Landmarks5): Float32Array {
  const { A, t } = similarityTransform(pts, ARCFACE_TEMPLATE);
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("Phép căn chỉnh suy biến");
  const inv = [[A[1][1] / det, -A[0][1] / det], [-A[1][0] / det, A[0][0] / det]];
  const N = FACE_SIZE * FACE_SIZE;
  const out = new Float32Array(3 * N);
  const px = (xx: number, yy: number, c: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : raw[(yy * W + xx) * 3 + c]);
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      const dx = x - t[0], dy = y - t[1];
      const sx = inv[0][0] * dx + inv[0][1] * dy;
      const sy = inv[1][0] * dx + inv[1][1] * dy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const v =
          px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) + px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy;
        out[c * N + y * FACE_SIZE + x] = (v - 127.5) / 127.5;
      }
    }
  }
  return out;
}

export function l2normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Điểm mốc hợp lệ: nằm trong ảnh, hai mắt cách nhau đủ xa (mặt không quá nhỏ). */
export function validateLandmarks(pts: Landmarks5, W: number, H: number, minEyeDist = 20): string | null {
  for (const [x, y] of pts) if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > W || y > H) return "Điểm mốc nằm ngoài ảnh";
  const eye = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
  if (eye < minEyeDist) return "Mặt quá nhỏ trong ảnh";
  return null;
}

type Engine = { session: InferenceSession; input: string; output: string };
const g = globalThis as unknown as { __faceEmbed?: Promise<Engine> | null; __faceEmbedError?: string | null; __faceEmbedHook?: EmbedHook | null };

export function loadFaceModel(): Promise<Engine> {
  g.__faceEmbed ??= (async () => {
    const path = faceModelPath();
    if (!existsSync(path)) throw new Error(`Không tìm thấy mô hình nhận diện ${path} — chạy: npm run models:face`);
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    g.__faceEmbedError = null;
    return { session, input: session.inputNames[0], output: session.outputNames[0] };
  })().catch((e) => {
    g.__faceEmbed = null;
    g.__faceEmbedError = (e as Error).message;
    throw e;
  });
  return g.__faceEmbed;
}

export function faceModelStatus() {
  const key = faceModelKey();
  return { key, label: FACE_MODELS[key].label, version: FACE_MODELS[key].version, modelPath: faceModelPath(), modelExists: existsSync(faceModelPath()), error: g.__faceEmbedError ?? null };
}

export type EmbedHook = (jpeg: Buffer, landmarks: Landmarks5) => Float32Array | null;
/** Chỉ dùng trong test: thay mô hình bằng hàm giả. */
export function __setFaceEmbedTestHook(hook: EmbedHook | null) {
  g.__faceEmbedHook = hook;
}

/** Embedding 512 chiều (chuẩn hóa L2) của mặt trong snapshot JPEG theo 5 điểm mốc (tọa độ pixel của snapshot). */
export async function embedFromSnapshot(jpeg: Buffer, landmarks: Landmarks5): Promise<{ embedding: Float32Array; ms: number }> {
  const t0 = Date.now();
  if (g.__faceEmbedHook) {
    const e = g.__faceEmbedHook(jpeg, landmarks);
    if (e) return { embedding: l2normalize(e), ms: Date.now() - t0 };
  }
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(jpeg, { failOn: "error" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bad = validateLandmarks(landmarks, info.width, info.height);
  if (bad) throw new Error(bad);
  const tensorData = alignFace(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, landmarks);
  const eng = await loadFaceModel();
  const ort = await import("onnxruntime-node");
  const out = await eng.session.run({ [eng.input]: new ort.Tensor("float32", tensorData, [1, 3, FACE_SIZE, FACE_SIZE]) });
  const vec = out[eng.output].data as Float32Array;
  if (vec.length !== EMBED_DIM) throw new Error(`Mô hình trả ${vec.length} chiều, mong đợi ${EMBED_DIM}`);
  return { embedding: l2normalize(vec), ms: Date.now() - t0 };
}
