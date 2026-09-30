/**
 * Kiểm đồng phục — nối các mảnh lại (v1.20.0).
 *
 * Luồng cho MỘT lượt kiểm: ảnh chấm công + khung mặt → cắt vùng ngực (nơi có logo) → cân bằng trắng →
 * ba tín hiệu (màu · logo · mô hình AI) → bảng quyết định (uniform-score.ts).
 *
 * LUẬT KHÓA CỨNG (xem CLAUDE.md):
 *   - Không chạy trong route chấm công; chỉ job nền gọi hàm này.
 *   - Ảnh thiếu / xấu ⇒ CẦN XEM LẠI, không bao giờ thành "không mặc đồng phục".
 *   - Ảnh vùng áo lưu lại không chứa khuôn mặt.
 */
import { SHIRT_CROP, centerBand, chestRect, type CropRect, type FaceBox } from "./uniform-crop";
import { brightnessStats, colorHistogram, grayWorldGains, meanColorHex, patternRatio, skinRatio } from "./uniform-color";
import { UNIFORM_INPUT_SIZE, UNIFORM_MODEL_VERSION, type UniformEmbedder } from "./uniform-embed";
import { decideUniform, scoreTemplates, type TemplateScore, type UniformDecision, type UniformQuality, type UniformThresholds, type UniformTemplateRef } from "./uniform-score";

/** Cạnh ảnh đưa vào mô hình AI — theo mô hình đang dùng (đổi mô hình thì đặt UNIFORM_INPUT_SIZE). */
export const EMBED_SIZE = UNIFORM_INPUT_SIZE;

export type ShirtFeature = {
  rect: CropRect;
  /** Biểu đồ màu (mảng thường để lưu JSON được). */
  colorHist: number[];
  /** "Độ không trơn" — dấu hiệu có logo trước ngực. */
  pattern: number;
  colorHex: string;
  quality: UniformQuality;
  embedding: number[] | null;
  embedVersion: string | null;
  /** Ảnh vùng áo đã cắt, JPEG nhỏ để Nhân sự xem lại. */
  cropJpeg: Buffer | null;
};

export type FeatureResult = { ok: true; feature: ShirtFeature } | { ok: false; reason: "CROP_OUT_OF_FRAME" | "CROP_TOO_SMALL" | "TOO_DARK" | "LOW_CONTRAST" };

/**
 * Trích đặc trưng vùng áo từ một ảnh JPEG. `embedder` có thể không sẵn sàng — khi đó bỏ tín hiệu mô hình.
 * `keepCrop = false` thì không sinh ảnh vùng áo (tiết kiệm chỗ, nhưng Nhân sự mất ảnh để đối chiếu).
 */
export async function extractShirtFeature(
  jpeg: Buffer,
  faceBox: FaceBox,
  opts: { embedder?: UniformEmbedder | null; keepCrop?: boolean } = {},
): Promise<FeatureResult> {
  const { default: sharp } = await import("sharp");
  const img = sharp(jpeg, { failOn: "none" });
  const meta = await img.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const crop = chestRect(imgW, imgH, faceBox, SHIRT_CROP);
  if (!crop.ok) return { ok: false, reason: crop.reason };

  // Cân bằng trắng tính trên TOÀN ảnh (có tường, tóc, da) — tính riêng trên vùng áo đơn sắc sẽ kéo áo về xám.
  const whole = await sharp(jpeg, { failOn: "none" }).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const gains = grayWorldGains(whole);

  const region = await sharp(jpeg, { failOn: "none" }).extract(crop.rect).removeAlpha().raw().toBuffer();
  const quality: UniformQuality = { ...statsOf(region), skin: skinRatio(region) };
  if (quality.brightness < 0.1) return { ok: false, reason: "TOO_DARK" };
  if (quality.contrast < 0.02) return { ok: false, reason: "LOW_CONTRAST" };

  // Màu: chỉ lấy dải giữa để tường / người đứng sau không lẫn vào.
  const bandRect = centerBand(crop.rect);
  const band = await sharp(jpeg, { failOn: "none" }).extract(bandRect).removeAlpha().raw().toBuffer();
  const hist = colorHistogram(band, gains);
  if (!hist) return { ok: false, reason: "TOO_DARK" };

  const cropJpeg =
    opts.keepCrop === false
      ? null
      : await sharp(jpeg, { failOn: "none" }).extract(crop.rect).resize(160, 160, { fit: "cover" }).jpeg({ quality: 72 }).toBuffer();

  let embedding: number[] | null = null;
  if (opts.embedder?.available) {
    const rgb = await sharp(jpeg, { failOn: "none" }).extract(crop.rect).resize(EMBED_SIZE, EMBED_SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const v = await opts.embedder.embed(new Uint8Array(rgb), EMBED_SIZE);
    embedding = v ? Array.from(v) : null;
  }

  return {
    ok: true,
    feature: {
      rect: crop.rect,
      colorHist: Array.from(hist),
      pattern: patternRatio(region),
      colorHex: meanColorHex(band, gains),
      quality,
      embedding,
      embedVersion: embedding ? UNIFORM_MODEL_VERSION : null,
      cropJpeg,
    },
  };
}

function statsOf(raw: Buffer): { brightness: number; contrast: number } {
  const s = brightnessStats(raw);
  return { brightness: s.mean, contrast: s.std };
}

/**
 * Đặc trưng của một ẢNH MẪU áo (ảnh áo rời hoặc vùng áo đã cắt sẵn) — không cần khung mặt.
 *
 * KHÔNG cân bằng trắng ở đây: ảnh mẫu là ảnh áo, gần như một màu, không có nền trung tính để lấy mốc — cân bằng sẽ
 * kéo chính màu áo về xám và làm hỏng mẫu. Cân bằng trắng chỉ áp cho ảnh chấm công (ảnh toàn khung, có tường/da/tóc),
 * mục đích là đưa ảnh chụp dưới đèn vàng về đúng điều kiện chuẩn của ảnh mẫu.
 */
export async function extractSampleFeature(jpeg: Buffer, embedder?: UniformEmbedder | null): Promise<{ colorHist: number[]; pattern: number; colorHex: string; embedding: number[] | null } | null> {
  const { default: sharp } = await import("sharp");
  const raw = await sharp(jpeg, { failOn: "none" }).resize(256, 256, { fit: "cover" }).removeAlpha().raw().toBuffer();
  const gains: [number, number, number] = [1, 1, 1];
  const hist = colorHistogram(raw, gains);
  if (!hist) return null;
  let embedding: number[] | null = null;
  if (embedder?.available) {
    const rgb = await sharp(jpeg, { failOn: "none" }).resize(EMBED_SIZE, EMBED_SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const v = await embedder.embed(new Uint8Array(rgb), EMBED_SIZE);
    embedding = v ? Array.from(v) : null;
  }
  return { colorHist: Array.from(hist), pattern: patternRatio(raw), colorHex: meanColorHex(raw, gains), embedding };
}

/** Trung bình các vector đặc trưng của nhiều ảnh mẫu, rồi chuẩn hóa lại. */
export function averageVectors(list: (number[] | null)[]): number[] | null {
  const ok = list.filter((v): v is number[] => !!v?.length);
  if (!ok.length) return null;
  const n = ok[0].length;
  const out = new Array<number>(n).fill(0);
  for (const v of ok) for (let i = 0; i < n; i++) out[i] += (v[i] ?? 0) / ok.length;
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm);
  return norm ? out.map((x) => x / norm) : out;
}

/** Trung bình các biểu đồ màu (đã chuẩn hóa tổng = 1). */
export function averageHistograms(list: (number[] | null)[]): number[] | null {
  const ok = list.filter((v): v is number[] => !!v?.length);
  if (!ok.length) return null;
  const n = ok[0].length;
  const out = new Array<number>(n).fill(0);
  for (const v of ok) for (let i = 0; i < n; i++) out[i] += (v[i] ?? 0) / ok.length;
  const sum = out.reduce((a, b) => a + b, 0);
  return sum ? out.map((x) => x / sum) : out;
}

export type EvaluateResult = UniformDecision & { scores: TemplateScore[]; quality: UniformQuality | null; pattern: number | null };

/** Chấm điểm một đặc trưng với các mẫu áo của phòng rồi kết luận. */
export function evaluateShirt(feature: ShirtFeature, templates: UniformTemplateRef[], th: UniformThresholds): EvaluateResult {
  const scores = scoreTemplates({ colorHist: feature.colorHist, embedding: feature.embedding, embedVersion: feature.embedVersion }, templates, th);
  const decision = decideUniform({ quality: feature.quality, scores, pattern: feature.pattern, th, modelFailed: !feature.embedding });
  return { ...decision, scores, quality: feature.quality, pattern: feature.pattern };
}
