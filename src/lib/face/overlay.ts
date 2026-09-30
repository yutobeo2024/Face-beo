/**
 * Đổi toạ độ từ KHUNG HÌNH VIDEO sang toạ độ trên màn hình (v1.20.2), để kiosk vẽ đúng chỗ máy đang nhìn.
 *
 * Thẻ <video> của kiosk dùng `object-cover` (ảnh phóng to cho phủ kín, phần thừa bị cắt) và `-scale-x-100`
 * (lật gương cho giống soi gương). Hai phép này phải được tính ngược lại, nếu không ô vẽ ra sẽ lệch — nhất là khi
 * tỉ lệ camera khác tỉ lệ màn hình tablet.
 *
 * Hàm thuần, không đụng DOM, nên test được không cần trình duyệt.
 */

export type Rect = { left: number; top: number; width: number; height: number };

/** Hệ số phóng và lề bị cắt của `object-cover`. */
export type CoverFit = { k: number; ox: number; oy: number };

/**
 * `object-cover`: phóng ảnh theo cạnh THIẾU nhiều hơn (lấy max) rồi canh giữa, phần thừa tràn ra ngoài.
 * `ox`/`oy` âm nghĩa là bị cắt bớt ở cạnh đó.
 */
export function coverFit(videoW: number, videoH: number, elW: number, elH: number): CoverFit {
  if (!(videoW > 0 && videoH > 0)) return { k: 1, ox: 0, oy: 0 };
  const k = Math.max(elW / videoW, elH / videoH);
  return { k, ox: (elW - videoW * k) / 2, oy: (elH - videoH * k) / 2 };
}

/**
 * Một vùng trong khung hình video → toạ độ CSS trên phần tử.
 * `mirrored` cho thẻ video đang lật gương: cạnh trái và phải đổi chỗ (`elW − (left + width)`).
 */
export function rectToScreen(rect: Rect, fit: CoverFit, elW: number, mirrored = true): Rect {
  const left = fit.ox + rect.left * fit.k;
  const width = rect.width * fit.k;
  return {
    left: mirrored ? elW - (left + width) : left,
    top: fit.oy + rect.top * fit.k,
    width,
    height: rect.height * fit.k,
  };
}

/** Khung mặt `[x, y, w, h]` của thư viện nhận diện → cùng dạng `Rect`. */
export function boxToRect(box: readonly [number, number, number, number] | number[]): Rect {
  return { left: box[0], top: box[1], width: box[2], height: box[3] };
}
