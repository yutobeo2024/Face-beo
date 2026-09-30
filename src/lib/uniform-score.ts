/**
 * Chấm điểm và kết luận đồng phục (v1.20.0) — hàm thuần, không đụng DB / mô hình.
 *
 * Hai tín hiệu độc lập phải ĐỒNG THUẬN thì mới dám kết luận:
 *   - màu áo (biểu đồ H×S, xem uniform-color.ts)
 *   - đặc trưng hình ảnh do mô hình AI sinh ra (cosine)
 * Lệch nhau ⇒ CẦN XEM LẠI. Nhờ vậy khi nhân viên khiếu nại còn giải thích được, và mô hình hỏng thì vẫn còn tầng màu.
 *
 * LUẬT KHÓA CỨNG: ảnh thiếu / xấu KHÔNG BAO GIỜ thành "không mặc đồng phục" — chỉ thành CẦN XEM LẠI.
 */
export type UniformStatus = "PASS" | "FAIL" | "REVIEW" | "SKIPPED";
export type UniformReason =
  | "LOW_SCORE" // cả hai tín hiệu đều thấp → kết luận không đạt
  | "AMBIGUOUS" // hai tín hiệu lệch nhau
  | "CROP_OUT_OF_FRAME"
  | "CROP_TOO_SMALL"
  | "TOO_DARK"
  | "TOO_BRIGHT"
  | "LOW_CONTRAST"
  | "SKIN_DOMINANT"
  | "NO_TEMPLATE"
  | "MODEL_ERROR"
  | "MODEL_VERSION_MISMATCH"
  | "LOW_CONFIDENCE_TEMPLATE" // mẫu áo còn ít ảnh, chưa đủ tin
  | "LOGO_MISSING" // màu giống áo đồng phục nhưng ngực trơn, không thấy logo
  | "SNAPSHOT_GONE";

export type UniformTemplateRef = {
  id: number;
  name: string;
  colorHist: number[] | null;
  embedding: number[] | null;
  embedVersion: string | null;
  sampleCount: number;
  /** "Độ không trơn" của mẫu áo (logo trước ngực). null = chưa đo được. */
  pattern?: number | null;
};

export type UniformThresholds = {
  /** Cosine tối thiểu để tín hiệu mô hình coi là khớp. */
  passEmbed: number;
  /** Độ giống màu tối thiểu để tín hiệu màu coi là khớp. */
  passColor: number;
  /** Điểm gộp dưới mức này mới dám kết luận KHÔNG ĐẠT. */
  failScore: number;
  /** Tỉ trọng của màu trong điểm gộp (0…1). */
  colorWeight: number;
};

/**
 * Áo đồng phục luôn có logo trước ngực. Mẫu áo có hoa văn (≥ LOGO_TEMPLATE_MIN) mà ảnh chụp lại TRƠN TUYỆT ĐỐI
 * (< LOGO_IMAGE_MIN) thì rất có thể là áo khác cùng màu → không cho ĐẠT thẳng, chuyển CẦN XEM LẠI để Nhân sự quyết.
 *
 * Dùng ngưỡng TUYỆT ĐỐI chứ không so tỉ lệ với mẫu: ảnh mẫu là cả cái áo, còn ảnh chụp chỉ là vùng ngực, logo
 * chiếm phần trăm diện tích khác nhau nên so tỉ lệ sẽ sai.
 */
export const LOGO_TEMPLATE_MIN = 0.04;
export const LOGO_IMAGE_MIN = 0.015;

export const DEFAULT_UNIFORM_THRESHOLDS: UniformThresholds = { passEmbed: 0.55, passColor: 0.55, failScore: 0.45, colorWeight: 0.4 };

/** Mẫu áo phải có ít nhất ngần này ảnh mẫu thì kết luận mới được coi là đáng tin. */
export const MIN_SAMPLES_TRUSTED = 3;

export type UniformQuality = { brightness: number; contrast: number; skin: number };
/** Ngưỡng chất lượng ảnh: ảnh chấm công vốn tối (đo thật 0,16–0,28) nên mốc "quá tối" đặt thấp. */
export const QUALITY_LIMITS = { minBrightness: 0.1, maxBrightness: 0.92, minContrast: 0.02, maxSkin: 0.5 };

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
}

export type TemplateScore = {
  templateId: number;
  name: string;
  embedScore: number | null;
  colorScore: number;
  score: number;
  sampleCount: number;
  versionOk: boolean;
  /** Độ không trơn của mẫu áo (logo) — so với `pattern` của ảnh để phát hiện áo cùng màu nhưng không có logo. */
  templatePattern?: number | null;
};

/** Điểm của vùng áo với từng mẫu áo của phòng, sắp giảm dần theo điểm gộp. */
export function scoreTemplates(
  feature: { colorHist: number[] | Float64Array; embedding: Float32Array | number[] | null; embedVersion: string | null },
  templates: UniformTemplateRef[],
  th: UniformThresholds = DEFAULT_UNIFORM_THRESHOLDS,
): TemplateScore[] {
  return templates
    .map((t) => {
      const colorScore = t.colorHist ? bhatt(feature.colorHist, t.colorHist) : 0;
      const versionOk = !!t.embedVersion && t.embedVersion === feature.embedVersion;
      const embedScore = feature.embedding && t.embedding && versionOk ? cosine(feature.embedding, t.embedding) : null;
      const score = embedScore === null ? colorScore : (1 - th.colorWeight) * embedScore + th.colorWeight * colorScore;
      return { templateId: t.id, name: t.name, embedScore, colorScore, score, sampleCount: t.sampleCount, versionOk, templatePattern: t.pattern ?? null };
    })
    .sort((a, b) => b.score - a.score);
}

/** Mẫu áo có logo rõ mà ảnh chụp lại trơn hẳn ⇒ nghi mặc áo khác cùng màu. */
function missingLogo(templatePattern: number | null | undefined, imagePattern: number | null | undefined): boolean {
  if (templatePattern == null || imagePattern == null) return false;
  if (templatePattern < LOGO_TEMPLATE_MIN) return false; // mẫu áo vốn trơn, không suy ra được gì
  return imagePattern < LOGO_IMAGE_MIN;
}

function bhatt(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.sqrt(Math.max(0, a[i]) * Math.max(0, b[i]));
  return Math.min(1, s);
}

export type UniformDecision = {
  status: UniformStatus;
  reason: UniformReason | null;
  templateId: number | null;
  templateName: string | null;
  score: number | null;
  embedScore: number | null;
  colorScore: number | null;
};

/**
 * Kết luận cuối cùng cho một lượt kiểm.
 * `cropReason` (nếu có) là lý do không cắt được vùng áo — ưu tiên cao nhất, luôn ra CẦN XEM LẠI.
 */
export function decideUniform(args: {
  cropReason?: UniformReason | null;
  quality?: UniformQuality | null;
  scores: TemplateScore[];
  modelFailed?: boolean;
  th?: UniformThresholds;
  /** Độ không trơn đo được trên ảnh chụp (xem patternRatio) — dùng để tìm logo trước ngực. */
  pattern?: number | null;
}): UniformDecision {
  const th = args.th ?? DEFAULT_UNIFORM_THRESHOLDS;
  const none: UniformDecision = { status: "REVIEW", reason: null, templateId: null, templateName: null, score: null, embedScore: null, colorScore: null };

  if (args.cropReason) return { ...none, reason: args.cropReason };
  const q = args.quality;
  if (q) {
    if (q.brightness < QUALITY_LIMITS.minBrightness) return { ...none, reason: "TOO_DARK" };
    if (q.brightness > QUALITY_LIMITS.maxBrightness) return { ...none, reason: "TOO_BRIGHT" };
    if (q.contrast < QUALITY_LIMITS.minContrast) return { ...none, reason: "LOW_CONTRAST" };
    if (q.skin > QUALITY_LIMITS.maxSkin) return { ...none, reason: "SKIN_DOMINANT" };
  }
  if (!args.scores.length) return { ...none, status: "SKIPPED", reason: "NO_TEMPLATE" };

  const best = args.scores[0];
  const base = {
    templateId: best.templateId,
    templateName: best.name,
    score: best.score,
    embedScore: best.embedScore,
    colorScore: best.colorScore,
  };

  // Mẫu áo còn ít ảnh: có điểm nhưng chưa đủ tin để kết luận — để Nhân sự nhìn ảnh quyết.
  if (best.sampleCount < MIN_SAMPLES_TRUSTED) return { ...base, status: "REVIEW", reason: "LOW_CONFIDENCE_TEMPLATE" };

  // Mô hình hỏng / mẫu tính bằng phiên bản mô hình khác: chỉ còn tầng màu, đòi hỏi chắc chắn hơn.
  if (args.modelFailed || best.embedScore === null) {
    const reason: UniformReason = args.modelFailed ? "MODEL_ERROR" : "MODEL_VERSION_MISMATCH";
    if (best.colorScore >= th.passColor + 0.1) {
      // Không có tín hiệu mô hình thì logo càng quan trọng: màu giống mà ngực trơn ⇒ nghi áo khác cùng màu.
      if (missingLogo(best.templatePattern, args.pattern)) return { ...base, status: "REVIEW", reason: "LOGO_MISSING" };
      return { ...base, status: "PASS", reason: null };
    }
    if (best.colorScore <= 0.35) return { ...base, status: "FAIL", reason: "LOW_SCORE" };
    return { ...base, status: "REVIEW", reason };
  }

  const embedOk = best.embedScore >= th.passEmbed;
  const colorOk = best.colorScore >= th.passColor;
  if (embedOk && colorOk) {
    if (missingLogo(best.templatePattern, args.pattern)) return { ...base, status: "REVIEW", reason: "LOGO_MISSING" };
    return { ...base, status: "PASS", reason: null };
  }
  if (!embedOk && !colorOk && best.score <= th.failScore) return { ...base, status: "FAIL", reason: "LOW_SCORE" };
  return { ...base, status: "REVIEW", reason: "AMBIGUOUS" };
}

/** Nhãn tiếng Việt cho giao diện, Excel và tin Zalo. */
export const UNIFORM_STATUS_LABEL: Record<UniformStatus, string> = {
  PASS: "Đạt",
  FAIL: "Không đạt",
  REVIEW: "Cần xem lại",
  SKIPPED: "Bỏ qua",
};

export const UNIFORM_REASON_LABEL: Record<UniformReason, string> = {
  LOW_SCORE: "Áo không giống mẫu nào của phòng",
  AMBIGUOUS: "Máy chưa chắc (màu và hình dáng không thống nhất)",
  CROP_OUT_OF_FRAME: "Ảnh không thấy đủ vùng áo (đứng quá sát camera)",
  CROP_TOO_SMALL: "Vùng áo trong ảnh quá nhỏ",
  TOO_DARK: "Ảnh quá tối",
  TOO_BRIGHT: "Ảnh bị chói",
  LOW_CONTRAST: "Vùng áo mờ, không rõ chi tiết",
  SKIN_DOMINANT: "Ảnh cắt trúng vùng da, chưa thấy áo",
  NO_TEMPLATE: "Phòng chưa khai mẫu áo nào",
  MODEL_ERROR: "Mô hình nhận dạng chưa sẵn sàng (chỉ so được màu áo)",
  MODEL_VERSION_MISMATCH: "Mẫu áo cần tính lại theo mô hình mới",
  LOW_CONFIDENCE_TEMPLATE: "Mẫu áo còn ít ảnh, chưa đủ tin",
  LOGO_MISSING: "Màu áo giống nhưng không thấy logo trước ngực",
  SNAPSHOT_GONE: "Ảnh chấm công đã bị xóa theo hạn lưu",
};
