// v1.20.2: lớp phủ kiosk vẽ đúng chỗ máy nhìn — đổi toạ độ qua object-cover + lật gương, và vùng áo chưa kẹp.
import { describe, expect, it } from "vitest";
import { boxToRect, coverFit, rectToScreen } from "@/lib/face/overlay";
import { chestRect, chestRectRaw, SHIRT_CROP } from "@/lib/uniform-crop";

describe("coverFit — object-cover", () => {
  it("video rộng hơn khung: phóng theo chiều cao, hai bên bị cắt", () => {
    // video 1280×720 (16:9) trong khung 800×600 (4:3) → k = max(0,625; 0,833) = 0,833
    const f = coverFit(1280, 720, 800, 600);
    expect(f.k).toBeCloseTo(600 / 720, 6);
    expect(f.oy).toBeCloseTo(0, 6);
    expect(f.ox).toBeLessThan(0); // tràn ra hai bên ⇒ bị cắt
    expect(f.ox).toBeCloseTo((800 - 1280 * f.k) / 2, 6);
  });

  it("video cao hơn khung: phóng theo chiều rộng, trên dưới bị cắt", () => {
    const f = coverFit(720, 1280, 800, 600);
    expect(f.k).toBeCloseTo(800 / 720, 6);
    expect(f.ox).toBeCloseTo(0, 6);
    expect(f.oy).toBeLessThan(0);
  });

  it("cùng tỉ lệ: không cắt gì", () => {
    const f = coverFit(1280, 720, 640, 360);
    expect(f.k).toBeCloseTo(0.5, 6);
    expect(f.ox).toBeCloseTo(0, 6);
    expect(f.oy).toBeCloseTo(0, 6);
  });

  it("chưa có kích thước video (camera đang mở) thì không chia cho 0", () => {
    expect(coverFit(0, 0, 800, 600)).toEqual({ k: 1, ox: 0, oy: 0 });
  });
});

describe("rectToScreen", () => {
  const fit = coverFit(1280, 720, 1280, 720); // 1:1 cho dễ đối chiếu

  it("không lật gương: giữ nguyên toạ độ", () => {
    expect(rectToScreen({ left: 100, top: 50, width: 200, height: 300 }, fit, 1280, false)).toEqual({ left: 100, top: 50, width: 200, height: 300 });
  });

  it("lật gương: vùng sát mép TRÁI của video hiện ở mép PHẢI màn hình", () => {
    const s = rectToScreen({ left: 0, top: 10, width: 200, height: 100 }, fit, 1280, true);
    expect(s.left).toBe(1280 - 200); // dính mép phải
    expect(s.top).toBe(10); // lật ngang không đụng chiều dọc
    expect(s.width).toBe(200);
  });

  it("lật gương hai lần thì về chỗ cũ", () => {
    const r = { left: 300, top: 40, width: 150, height: 190 };
    const once = rectToScreen(r, fit, 1280, true);
    expect(rectToScreen(once, fit, 1280, true).left).toBeCloseTo(r.left, 6);
  });

  it("có phóng và cắt: cộng cả hệ số lẫn lề", () => {
    const f = coverFit(1280, 720, 800, 600); // k = 0,8333 · ox < 0
    const s = rectToScreen({ left: 640, top: 360, width: 100, height: 100 }, f, 800, false);
    expect(s.left).toBeCloseTo(f.ox + 640 * f.k, 6);
    expect(s.top).toBeCloseTo(f.oy + 360 * f.k, 6);
    expect(s.width).toBeCloseTo(100 * f.k, 6);
  });

  it("boxToRect đổi khung mặt [x,y,w,h] sang Rect", () => {
    expect(boxToRect([520, 330, 150, 190])).toEqual({ left: 520, top: 330, width: 150, height: 190 });
  });
});

describe("chestRectRaw — vùng áo chưa kẹp", () => {
  const box: [number, number, number, number] = [520, 330, 150, 190];

  it("đúng tỉ lệ SHIRT_CROP và nằm hẳn dưới cằm", () => {
    const r = chestRectRaw(box);
    expect(r.width).toBeCloseTo(SHIRT_CROP.widthFactor * 150, 6);
    expect(r.height).toBeCloseTo(SHIRT_CROP.heightFactor * 190, 6);
    expect(r.top).toBeGreaterThan(box[1] + box[3]); // dưới cằm ⇒ không dính khuôn mặt
    expect(r.left + r.width / 2).toBeCloseTo(box[0] + box[2] / 2, 6); // cùng trục dọc với mặt
  });

  it("nằm trọn trong khung hình thì trùng chestRect (chỉ khác làm tròn)", () => {
    const raw = chestRectRaw(box);
    const c = chestRect(1280, 720, box);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.rect.left).toBe(Math.round(raw.left));
    expect(c.rect.top).toBe(Math.round(raw.top));
    expect(c.rect.width).toBe(Math.round(raw.left + raw.width) - Math.round(raw.left));
  });

  it("đứng quá sát: vùng áo TỤT RA NGOÀI đáy khung — đó là cái người nhìn thấy trên kiosk", () => {
    const sat: [number, number, number, number] = [400, 120, 400, 520]; // mặt to, cằm gần đáy 720
    const raw = chestRectRaw(sat);
    expect(raw.top + raw.height).toBeGreaterThan(720);
    expect(chestRect(1280, 720, sat).ok).toBe(false); // và máy cũng từ chối
  });

  it("khung mặt không hợp lệ thì báo lỗi rõ ràng", () => {
    expect(() => chestRectRaw([0, 0, 0, 100])).toThrow("Khung mặt không hợp lệ");
  });
});
