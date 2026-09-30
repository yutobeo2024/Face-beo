/**
 * Đặc trưng MÀU của vùng áo (v1.20.0) — hàm thuần trên mảng pixel RGB, không đụng sharp/DB.
 *
 * Vì sao cần: ảnh chấm công phơi sáng theo khuôn mặt nên vùng áo rất tối (đo trên 60 ảnh thật: độ sáng 0,16–0,28).
 * So màu thô sẽ nhầm navy với đen. Ba bước xử lý:
 *   1. Cân bằng trắng Shades-of-Gray (Minkowski p=6) — khử ánh đèn vàng / đèn lạnh của phòng.
 *   2. Biểu đồ màu theo sắc (H) × độ đậm (S), BỎ kênh độ sáng (V) — cùng một áo dưới đèn mạnh hay yếu vẫn khớp.
 *   3. Ba ô riêng cho màu "vô sắc" (trắng / xám / đen) theo độ sáng — áo trắng và áo đen không có sắc màu,
 *      thiếu ba ô này là mù hẳn với chúng.
 * So hai biểu đồ bằng hệ số Bhattacharyya (0…1, càng lớn càng giống).
 */
export const HUE_BINS = 24;
export const SAT_BINS = 4;
/** 24×4 ô có màu + 3 ô vô sắc (tối / trung / sáng). */
export const HIST_SIZE = HUE_BINS * SAT_BINS + 3;

/** Dưới mức này coi như không có sắc màu (trắng, xám, đen). */
const CHROMA_MIN_SAT = 0.12;
/** Điểm ảnh quá tối / quá sáng thì màu không còn tin được, bỏ qua khi dựng biểu đồ. */
const V_MIN = 0.06;
const V_MAX = 0.97;

export type Rgb = { r: number; g: number; b: number };

/** Hệ số nhân từng kênh để "xám trung bình" trở về trung tính (Shades-of-Gray, p = 6). */
export function grayWorldGains(px: Uint8Array | Uint8ClampedArray | number[], p = 6): [number, number, number] {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const n = Math.floor(px.length / 3);
  if (!n) return [1, 1, 1];
  for (let i = 0; i < n; i++) {
    sr += Math.pow(px[i * 3], p);
    sg += Math.pow(px[i * 3 + 1], p);
    sb += Math.pow(px[i * 3 + 2], p);
  }
  const mr = Math.pow(sr / n, 1 / p);
  const mg = Math.pow(sg / n, 1 / p);
  const mb = Math.pow(sb / n, 1 / p);
  const mean = (mr + mg + mb) / 3 || 1;
  // Kẹp biên độ: đủ sửa đèn vàng / LED lạnh (lệch tới chừng 40%), nhưng không cho kéo quá tay khi khung hình ít nền
  // trung tính. Gray-world chỉ đúng khi ảnh có đủ tường / da / tóc — nên chỉ dùng cho ảnh chấm công toàn khung,
  // KHÔNG dùng cho ảnh mẫu áo (xem extractSampleFeature).
  const gain = (m: number) => (m > 1 ? Math.min(1.7, Math.max(0.6, mean / m)) : 1);
  return [gain(mr), gain(mg), gain(mb)];
}

export function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Biểu đồ màu của một vùng ảnh RGB phẳng (`[r,g,b, r,g,b, …]`).
 * `gains` = kết quả `grayWorldGains` tính trên TOÀN ảnh (không phải chỉ vùng áo) để khử màu đèn.
 * Trả `null` khi gần như không còn điểm ảnh dùng được (vùng quá tối / cháy sáng).
 */
export function colorHistogram(px: Uint8Array | Uint8ClampedArray | number[], gains: [number, number, number] = [1, 1, 1]): Float64Array | null {
  const hist = new Float64Array(HIST_SIZE);
  const n = Math.floor(px.length / 3);
  let used = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, px[i * 3] * gains[0]);
    const g = Math.min(255, px[i * 3 + 1] * gains[1]);
    const b = Math.min(255, px[i * 3 + 2] * gains[2]);
    const { h, s, v } = rgbToHsv({ r, g, b });
    if (v < V_MIN || v > V_MAX) continue;
    used++;
    if (s < CHROMA_MIN_SAT) {
      // Vô sắc: chia theo độ sáng — tối (đen) / trung (xám) / sáng (trắng)
      const k = v < 0.33 ? 0 : v < 0.66 ? 1 : 2;
      hist[HUE_BINS * SAT_BINS + k] += 1;
      continue;
    }
    const hb = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS));
    const sb = Math.min(SAT_BINS - 1, Math.floor(((s - CHROMA_MIN_SAT) / (1 - CHROMA_MIN_SAT)) * SAT_BINS));
    hist[hb * SAT_BINS + sb] += 1;
  }
  if (used < Math.max(16, n * 0.15)) return null;
  for (let i = 0; i < hist.length; i++) hist[i] /= used;
  return hist;
}

/** Độ giống nhau của hai biểu đồ màu: hệ số Bhattacharyya, 1 = trùng khít, 0 = không chung gì. */
export function histSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.sqrt(a[i] * b[i]);
  return Math.min(1, s);
}

/** Độ sáng trung bình (0…1) và độ tương phản (lệch chuẩn) của vùng — để chặn ảnh quá tối / cháy sáng. */
export function brightnessStats(px: Uint8Array | Uint8ClampedArray | number[]): { mean: number; std: number } {
  const n = Math.floor(px.length / 3);
  if (!n) return { mean: 0, std: 0 };
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const v = (0.299 * px[i * 3] + 0.587 * px[i * 3 + 1] + 0.114 * px[i * 3 + 2]) / 255;
    sum += v;
    sq += v * v;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/** Tỉ lệ điểm ảnh màu da (YCbCr) — cao quá nghĩa là cắt trúng cổ/tay chứ không phải áo. */
export function skinRatio(px: Uint8Array | Uint8ClampedArray | number[]): number {
  const n = Math.floor(px.length / 3);
  if (!n) return 0;
  let skin = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * 3];
    const g = px[i * 3 + 1];
    const b = px[i * 3 + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) skin++;
  }
  return skin / n;
}

/**
 * "Độ không trơn" của vùng ngực — tỉ lệ điểm ảnh lệch hẳn khỏi màu nền của áo (0…1).
 *
 * Áo đồng phục của phòng khám LUÔN có logo trước ngực, nên vùng này không bao giờ trơn tuyệt đối. Áo thường cùng màu
 * thì trơn. Đây là dấu hiệu KHÔNG đổi theo ánh sáng (khác với màu), nên rất hữu ích để tách hai áo cùng tông.
 *
 * Cách đo: lấy màu nền = trung vị từng kênh của cả vùng, rồi đếm điểm lệch quá `tol` (khoảng cách Chebyshev).
 * Dùng trung vị chứ không dùng trung bình để logo (chiếm thiểu số) không tự kéo mốc về phía nó.
 */
export function patternRatio(px: Uint8Array | Uint8ClampedArray | number[], tol = 38): number {
  const n = Math.floor(px.length / 3);
  if (n < 16) return 0;
  const med = (ch: number) => {
    const v: number[] = [];
    for (let i = 0; i < n; i++) v.push(px[i * 3 + ch]);
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const [mr, mg, mb] = [med(0), med(1), med(2)];
  let off = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(px[i * 3] - mr), Math.abs(px[i * 3 + 1] - mg), Math.abs(px[i * 3 + 2] - mb));
    if (d > tol) off++;
  }
  return off / n;
}

/** Màu trung bình của vùng (sau cân bằng trắng) — chỉ để hiện ô màu trên giao diện cho người xem hiểu. */
export function meanColorHex(px: Uint8Array | Uint8ClampedArray | number[], gains: [number, number, number] = [1, 1, 1]): string {
  const n = Math.floor(px.length / 3);
  if (!n) return "#000000";
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    r += Math.min(255, px[i * 3] * gains[0]);
    g += Math.min(255, px[i * 3 + 1] * gains[1]);
    b += Math.min(255, px[i * 3 + 2] * gains[2]);
  }
  const hex = (x: number) => Math.round(x / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
