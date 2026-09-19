import { describe, expect, it } from "vitest";
import { ABSENT_FRAMES, cooldownStep, MAX_COOLDOWN_MS, RETRY_MS, startCooldown, type Box, type CooldownState } from "@/lib/face/cooldown";

const me: Box = [400, 100, 300, 300];
const meShifted: Box = [430, 110, 290, 290]; // cùng chỗ, hơi nhúc nhích
const other: Box = [50, 120, 280, 280]; // vị trí khác hẳn (lệch > 0.6 × 300)

function run(s: CooldownState, frames: { faceCount: number; box: Box | null }[], t0 = 0) {
  let st = s;
  for (let i = 0; i < frames.length; i++) {
    const r = cooldownStep(st, { ...frames[i], now: t0 + i * 100 });
    st = r.state;
    if (r.done) return { done: true, at: i };
  }
  return { done: false, at: -1 };
}

describe("kiosk cooldown sau khi chấm công (theo khung mặt)", () => {
  it("cùng một người đứng yên: không quét lại trong 5 giây; quá 5 giây thì sẵn sàng (không kẹt khi người sau đứng đúng chỗ)", () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({ faceCount: 1, box: i % 2 ? me : meShifted }));
    const r = run(startCooldown(me, 0), frames); // 100 ms/khung
    expect(r.done).toBe(true);
    expect(r.at * 100).toBeGreaterThanOrEqual(MAX_COOLDOWN_MS);
    expect(run(startCooldown(me, 0), frames.slice(0, 40)).done).toBe(false);
  });

  it("mặt to lên hẳn (người khác đứng sát hơn) 3 khung: sẵn sàng", () => {
    const close: Box = [380, 60, 480, 480];
    expect(run(startCooldown(me, 0), [{ faceCount: 1, box: me }, ...Array(3).fill({ faceCount: 1, box: close })])).toEqual({ done: true, at: 3 });
  });

  it("rời khỏi camera đủ 8 khung liên tiếp: sẵn sàng", () => {
    const r = run(startCooldown(me, 0), [{ faceCount: 1, box: me }, ...Array.from({ length: ABSENT_FRAMES }, () => ({ faceCount: 0, box: null }))]);
    expect(r).toEqual({ done: true, at: ABSENT_FRAMES });
  });

  it("mất mặt chập chờn (lẻ tẻ vài khung) thì bộ đếm reset, chưa thoát", () => {
    const flicker = Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? { faceCount: 1, box: me } : { faceCount: 0, box: null }));
    expect(run(startCooldown(me, 0), flicker).done).toBe(false);
  });

  it("người khác bước vào ở vị trí khác hẳn 3 khung liên tiếp: sẵn sàng", () => {
    const r = run(startCooldown(me, 0), [
      { faceCount: 1, box: me },
      { faceCount: 1, box: other },
      { faceCount: 1, box: other },
      { faceCount: 1, box: other },
    ]);
    expect(r).toEqual({ done: true, at: 3 });
  });

  it("hai mặt trong khung không tính là người khác", () => {
    const r = run(startCooldown(me, 0), Array.from({ length: 20 }, () => ({ faceCount: 2, box: other })));
    expect(r.done).toBe(false);
  });

  it("sau kết quả thất bại (không có khung) cho thử lại sau 1.5 giây", () => {
    const s = startCooldown(null, 0);
    expect(cooldownStep(s, { faceCount: 1, box: me, now: RETRY_MS - 1 }).done).toBe(false);
    expect(cooldownStep(s, { faceCount: 1, box: me, now: RETRY_MS }).done).toBe(true);
  });
});
