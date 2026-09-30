/**
 * Cắt vùng áo từ ảnh chấm công (v1.20.0) — hàm thuần, không đụng sharp/DB nên test chạy nhanh.
 *
 * Ảnh kiosk là ảnh TOÀN KHUNG và lượt quét gửi kèm khung khuôn mặt `[x, y, w, h]` (pixel theo ảnh đã lưu),
 * nên vùng áo suy ra được bằng tỉ lệ so với khuôn mặt — tự co giãn theo khoảng cách người đứng.
 *
 * BẤT BIẾN: vùng cắt luôn nằm DƯỚI cằm, không bao giờ giao với khung mặt ⇒ ảnh vùng áo lưu lại KHÔNG chứa
 * khuôn mặt. Đây là lý do ảnh này không phải dữ liệu sinh trắc (xem CLAUDE.md).
 *
 * Cắt không đủ dữ liệu thì trả lý do để nơi gọi kết luận CẦN XEM LẠI — không bao giờ suy ra "không mặc đồng phục"
 * từ một tấm ảnh thiếu.
 */
export type FaceBox = [number, number, number, number];
export type CropRect = { left: number; top: number; width: number; height: number };
export type CropReason = "CROP_OUT_OF_FRAME" | "CROP_TOO_SMALL";
export type CropResult = { ok: true; rect: CropRect; coverage: number } | { ok: false; reason: CropReason; coverage: number };

export type CropOptions = {
  /** Bề ngang vùng áo = mấy lần bề ngang khuôn mặt (vai rộng hơn đầu). */
  widthFactor: number;
  /** Chiều cao vùng áo = mấy lần chiều cao khuôn mặt. */
  heightFactor: number;
  /** Mép trên vùng áo = cách đỉnh đầu mấy lần chiều cao mặt (> 1 ⇒ luôn dưới cằm, bỏ phần cổ). */
  topOffset: number;
  /** Phần diện tích còn lại sau khi kẹp vào ảnh, dưới mức này coi như không thấy áo. */
  minCoverage: number;
  /** Cạnh nhỏ nhất của vùng cắt (pixel) — nhỏ quá thì màu sắc không còn tin được. */
  minSidePx: number;
};

/**
 * Tỉ lệ mặc định: vùng từ 0,3 đến 1,2 lần chiều cao khuôn mặt tính từ cằm — ôm trọn chỗ đặt LOGO trước ngực áo
 * (áo đồng phục của phòng khám luôn có logo ở đây, đó là dấu hiệu không đổi theo ánh sáng).
 * Hiệu chỉnh lại sau đợt chạy thử nếu bố cục thực tế lệch.
 */
export const SHIRT_CROP: CropOptions = { widthFactor: 1.6, heightFactor: 0.9, topOffset: 1.3, minCoverage: 0.6, minSidePx: 96 };

/**
 * Vùng áo trong ảnh `imgW × imgH` theo khung mặt `faceBox`.
 * Ví dụ: ảnh 1280×720, mặt [540, 170, 200, 250] → vùng mong muốn rộng 320, cao 212, bắt đầu ở (480, 482).
 */
export function chestRect(imgW: number, imgH: number, faceBox: FaceBox, opts: CropOptions = SHIRT_CROP): CropResult {
  const [fx, fy, fw, fh] = faceBox;
  if (!(imgW > 0 && imgH > 0)) throw new Error("Kích thước ảnh không hợp lệ");
  if (!(fw > 0 && fh > 0)) throw new Error("Khung mặt không hợp lệ");

  const wantW = opts.widthFactor * fw;
  const wantH = opts.heightFactor * fh;
  const wantLeft = fx + fw / 2 - wantW / 2;
  const wantTop = fy + opts.topOffset * fh;

  const left = Math.round(Math.max(0, wantLeft));
  const top = Math.round(Math.max(0, wantTop));
  const right = Math.round(Math.min(imgW, wantLeft + wantW));
  const bottom = Math.round(Math.min(imgH, wantTop + wantH));
  const width = right - left;
  const height = bottom - top;
  const coverage = width > 0 && height > 0 ? (width * height) / (wantW * wantH) : 0;

  if (coverage < opts.minCoverage) return { ok: false, reason: "CROP_OUT_OF_FRAME", coverage };
  if (Math.min(width, height) < opts.minSidePx) return { ok: false, reason: "CROP_TOO_SMALL", coverage };
  return { ok: true, rect: { left, top, width, height }, coverage };
}

/** Dải giữa của vùng áo (bỏ hai bên cho khỏi lẫn tường / người đứng sau) — dùng khi tính màu. */
export function centerBand(rect: CropRect, ratio = 0.7): CropRect {
  const width = Math.max(1, Math.round(rect.width * ratio));
  return { left: rect.left + Math.round((rect.width - width) / 2), top: rect.top, width, height: rect.height };
}
