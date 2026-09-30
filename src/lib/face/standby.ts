/**
 * Chế độ chờ của kiosk (v1.21.0): camera TẮT cho tới khi có người chạm màn hình.
 *
 * Lý do: máy đặt ở lối đi, camera bật suốt thì người đi ngang có thể bị ghi một lượt quét. Lượt sớm nhất trong ngày
 * là VÀO, mọi lượt sau đều là RA (xem computeDayLogs) — nên một lượt đi ngang lỡ là lượt cuối ngày sẽ thành "về sớm"
 * oan. Chờ với camera tắt thì việc đó không xảy ra được, và camera cũng chỉ bật vài giây mỗi lượt.
 *
 * Hàm thuần, không đụng DOM, để unit test được.
 */

/** Đang thức mà không thấy khuôn mặt nào suốt `idleSeconds` thì về chờ. `lastSeenAt` null = chưa từng thấy ai. */
export function isIdle(now: number, lastSeenAt: number | null, idleSeconds: number): boolean {
  if (idleSeconds <= 0) return false; // 0 = không tự ngủ
  if (lastSeenAt == null) return false; // mốc do nơi gọi đặt khi bắt đầu thức
  return now - lastSeenAt >= idleSeconds * 1000;
}

/**
 * Chấm xong thì đi đâu.
 * `awakeSeconds = 0` (mặc định) → về chờ ngay, an toàn nhất: người tiếp theo phải chạm.
 * `> 0` → giữ camera thức thêm cho người đang xếp hàng, qua "hồi chiêu" như cũ.
 */
export function phaseAfterResult(awakeSeconds: number): "standby" | "cooldown" {
  return awakeSeconds > 0 ? "cooldown" : "standby";
}
