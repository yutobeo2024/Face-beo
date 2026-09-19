/**
 * "Hồi chiêu" của kiosk sau mỗi lần hiện kết quả: không quét lại người vừa chấm khi họ vẫn đứng trước camera.
 * Không còn embedding trên máy (nhận diện chạy ở server) nên theo dõi bằng KHUNG MẶT. Thoát về trạng thái sẵn sàng khi:
 *  1. không còn mặt trong ABSENT_FRAMES khung liên tiếp (người đã rời đi), hoặc
 *  2. có đúng 1 mặt ở VỊ TRÍ KHÁC HẲN (tâm khung lệch quá DIFFERENT_RATIO × bề rộng khung cũ) trong DIFFERENT_FRAMES khung liên tiếp
 *     — người khác bước vào chỗ khác, hoặc
 *  3. kết quả trước thất bại (lastBox = null) và đã qua RETRY_MS — cho phép thử lại.
 * Hàm thuần, không phụ thuộc DOM/Human để unit test được.
 */
export const ABSENT_FRAMES = 8;
export const DIFFERENT_FRAMES = 3;
export const DIFFERENT_RATIO = 0.6;
export const RETRY_MS = 1500;

export type Box = [number, number, number, number]; // x, y, w, h

export type CooldownState = {
  lastBox: Box | null;
  absentFrames: number;
  differentFrames: number;
  since: number;
};

export type CooldownObs = { faceCount: number; box: Box | null; now: number };

export function startCooldown(lastBox: Box | null, now: number): CooldownState {
  return { lastBox: lastBox ? [...lastBox] : null, absentFrames: 0, differentFrames: 0, since: now };
}

/** Tâm khung mới lệch khỏi tâm khung cũ quá DIFFERENT_RATIO × bề rộng khung cũ => coi là vị trí khác. */
export function isDifferentPosition(last: Box, box: Box): boolean {
  const dx = box[0] + box[2] / 2 - (last[0] + last[2] / 2);
  const dy = box[1] + box[3] / 2 - (last[1] + last[3] / 2);
  return Math.hypot(dx, dy) > DIFFERENT_RATIO * Math.max(1, last[2]);
}

export function cooldownStep(s: CooldownState, obs: CooldownObs): { state: CooldownState; done: boolean } {
  if (!s.lastBox) return { state: s, done: obs.now - s.since >= RETRY_MS };

  const absentFrames = obs.faceCount === 0 ? s.absentFrames + 1 : 0;
  let differentFrames = 0;
  if (obs.faceCount === 1 && obs.box) differentFrames = isDifferentPosition(s.lastBox, obs.box) ? s.differentFrames + 1 : 0;
  const state = { ...s, absentFrames, differentFrames };
  return { state, done: absentFrames >= ABSENT_FRAMES || differentFrames >= DIFFERENT_FRAMES };
}
