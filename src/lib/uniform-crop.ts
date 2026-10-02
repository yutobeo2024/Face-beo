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
 * Tỉ lệ mặc định — ĐO TRÊN ẢNH THẬT của phòng khám (13 lượt chấm công 01–02/10/2026), không phải số đoán.
 *
 * Bộ dò khuôn mặt (BlazeFace) phát ra khung **vuông** (202×202, 258×258… — đo thật, lệch ≤ 1 px), nên `h` ở đây xấp xỉ
 * BỀ NGANG mặt chứ không phải chiều cao mặt. Bản đầu đặt `topOffset = 1,3` vì tưởng khung cao hơn rộng ⇒ vùng cắt bắt
 * đầu quá thấp và **đi qua mất logo**: 3/6 ảnh ngày 02/10 không thấy logo. Cắt từ NGAY DƯỚI CẰM thì cả 3 đều hiện logo.
 *
 * `topOffset = 1,05` (không phải 1,0) để chừa biên dưới cằm, giữ bất biến "ảnh vùng áo không chứa khuôn mặt" kể cả khi
 * làm tròn số thực. `heightFactor = 1,05` phủ hết vùng ngực nơi đặt logo.
 */
export const SHIRT_CROP: CropOptions = { widthFactor: 1.6, heightFactor: 1.05, topOffset: 1.05, minCoverage: 0.6, minSidePx: 96 };

/**
 * Khoảng trống DƯỚI CẰM mà vùng áo cần, tính theo lần chiều cao khung mặt.
 *
 * Cổng chất lượng của kiosk (`checkGate`, tham số `chestRoom`) phải dùng ĐÚNG hằng này. Trước đây cổng ghi tay 1,1
 * trong khi vùng cắt cần 1,2 ⇒ 5/13 ảnh bị cắt hụt đáy khung hình. Suy ra từ chính `SHIRT_CROP` nên hai bên không bao
 * giờ lệch lại được, và đúng với mọi camera / mọi tỉ lệ khung hình.
 */
export const CHEST_ROOM_NEEDED = SHIRT_CROP.topOffset + SHIRT_CROP.heightFactor - 1;

/**
 * Vùng áo MONG MUỐN theo khung mặt, số thực và CHƯA kẹp vào khung hình.
 *
 * Kiosk vẽ đúng vùng này lên màn hình (v1.20.2): đứng quá sát thì người thấy dải tụt hẳn ra ngoài đáy khung — tự hiểu
 * vì sao máy bảo lùi lại. Dùng chung hằng số với `chestRect` nên hình vẽ không bao giờ lệch với chỗ máy chủ cắt thật.
 */
export function chestRectRaw(faceBox: FaceBox, opts: CropOptions = SHIRT_CROP): { left: number; top: number; width: number; height: number } {
  const [fx, fy, fw, fh] = faceBox;
  if (!(fw > 0 && fh > 0)) throw new Error("Khung mặt không hợp lệ");
  const width = opts.widthFactor * fw;
  const height = opts.heightFactor * fh;
  return { left: fx + fw / 2 - width / 2, top: fy + opts.topOffset * fh, width, height };
}

/**
 * Vùng áo trong ảnh `imgW × imgH` theo khung mặt `faceBox`.
 * Ví dụ: ảnh 1280×720, mặt [540, 170, 200, 200] → vùng mong muốn rộng 320, cao 210, bắt đầu ở (480, 380).
 */
export function chestRect(imgW: number, imgH: number, faceBox: FaceBox, opts: CropOptions = SHIRT_CROP): CropResult {
  if (!(imgW > 0 && imgH > 0)) throw new Error("Kích thước ảnh không hợp lệ");
  const want = chestRectRaw(faceBox, opts);
  const wantW = want.width;
  const wantH = want.height;
  const wantLeft = want.left;
  const wantTop = want.top;

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
