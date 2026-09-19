/**
 * "Hồi chiêu" của kiosk sau mỗi lần hiện kết quả: không quét lại người vừa chấm khi họ vẫn đứng trước camera.
 * Thoát về trạng thái sẵn sàng khi:
 *  1. không còn mặt trong ABSENT_FRAMES khung liên tiếp (người đã rời đi), hoặc
 *  2. có đúng 1 mặt KHÁC người vừa chấm (cosine < DIFFERENT_COSINE) trong DIFFERENT_FRAMES khung liên tiếp, hoặc
 *  3. kết quả trước thất bại (lastEmbedding = null) và đã qua RETRY_MS — cho phép thử lại.
 * Hàm thuần, không phụ thuộc DOM/Human để unit test được.
 */
export const ABSENT_FRAMES = 8;
export const DIFFERENT_FRAMES = 3;
export const DIFFERENT_COSINE = 0.5;
export const RETRY_MS = 1500;

export type CooldownState = {
  lastEmbedding: Float32Array | null;
  absentFrames: number;
  differentFrames: number;
  since: number;
};

export type CooldownObs = { faceCount: number; embedding: ArrayLike<number> | null; now: number };

export function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

export function startCooldown(lastEmbedding: ArrayLike<number> | null, now: number): CooldownState {
  return { lastEmbedding: lastEmbedding ? normalize(lastEmbedding) : null, absentFrames: 0, differentFrames: 0, since: now };
}

export function cooldownStep(s: CooldownState, obs: CooldownObs): { state: CooldownState; done: boolean } {
  if (!s.lastEmbedding) return { state: s, done: obs.now - s.since >= RETRY_MS };

  const absentFrames = obs.faceCount === 0 ? s.absentFrames + 1 : 0;
  let differentFrames = 0;
  if (obs.faceCount === 1 && obs.embedding && obs.embedding.length) {
    const different = cosine(normalize(obs.embedding), s.lastEmbedding) < DIFFERENT_COSINE;
    differentFrames = different ? s.differentFrames + 1 : 0;
  }
  const state = { ...s, absentFrames, differentFrames };
  return { state, done: absentFrames >= ABSENT_FRAMES || differentFrames >= DIFFERENT_FRAMES };
}
