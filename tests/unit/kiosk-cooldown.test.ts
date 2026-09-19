import { describe, expect, it } from "vitest";
import { ABSENT_FRAMES, cooldownStep, RETRY_MS, startCooldown, type CooldownState } from "@/lib/face/cooldown";

const vec = (seed: number) => Array.from({ length: 64 }, (_, i) => Math.sin(i * seed + seed));
const me = vec(1);
const meNoisy = me.map((v, i) => v + Math.cos(i) * 0.05);
const other = vec(7);

function run(s: CooldownState, frames: { faceCount: number; embedding: number[] | null }[], t0 = 0) {
  let st = s;
  for (let i = 0; i < frames.length; i++) {
    const r = cooldownStep(st, { ...frames[i], now: t0 + i * 100 });
    st = r.state;
    if (r.done) return { done: true, at: i };
  }
  return { done: false, at: -1 };
}

describe("kiosk cooldown sau khi chấm công", () => {
  it("cùng một người đứng yên 200 khung: không bao giờ quét lại", () => {
    const r = run(startCooldown(me, 0), Array.from({ length: 200 }, () => ({ faceCount: 1, embedding: meNoisy })));
    expect(r.done).toBe(false);
  });

  it("rời khỏi camera đủ 8 khung liên tiếp: sẵn sàng", () => {
    const r = run(startCooldown(me, 0), [
      { faceCount: 1, embedding: me },
      ...Array.from({ length: ABSENT_FRAMES }, () => ({ faceCount: 0, embedding: null })),
    ]);
    expect(r).toEqual({ done: true, at: ABSENT_FRAMES });
  });

  it("mất mặt chập chờn (lẻ tẻ vài khung) thì bộ đếm reset, chưa thoát", () => {
    const flicker = Array.from({ length: 60 }, (_, i) => (i % 5 === 4 ? { faceCount: 1, embedding: me } : { faceCount: 0, embedding: null }));
    expect(run(startCooldown(me, 0), flicker).done).toBe(false);
  });

  it("người khác bước vào ngay (cosine thấp) 3 khung liên tiếp: sẵn sàng", () => {
    const r = run(startCooldown(me, 0), [
      { faceCount: 1, embedding: me },
      { faceCount: 1, embedding: other },
      { faceCount: 1, embedding: other },
      { faceCount: 1, embedding: other },
    ]);
    expect(r).toEqual({ done: true, at: 3 });
  });

  it("hai mặt trong khung không tính là người khác", () => {
    const r = run(startCooldown(me, 0), Array.from({ length: 20 }, () => ({ faceCount: 2, embedding: other })));
    expect(r.done).toBe(false);
  });

  it("sau kết quả thất bại (không có embedding) cho thử lại sau 1.5 giây", () => {
    const s = startCooldown(null, 0);
    expect(cooldownStep(s, { faceCount: 1, embedding: me, now: RETRY_MS - 1 }).done).toBe(false);
    expect(cooldownStep(s, { faceCount: 1, embedding: me, now: RETRY_MS }).done).toBe(true);
  });
});
