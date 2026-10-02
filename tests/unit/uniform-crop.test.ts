// v1.20.0: cắt vùng áo từ khung mặt — hàm thuần, không cần ảnh thật.
import { describe, expect, it } from "vitest";
import { CHEST_ROOM_NEEDED, chestRect, centerBand, SHIRT_CROP, type FaceBox } from "@/lib/uniform-crop";

const IMG_W = 1280;
const IMG_H = 720;

describe("cắt vùng áo", () => {
  it("mặt chuẩn giữa khung → vùng áo nằm trọn trong ảnh, đúng tỉ lệ", () => {
    // Khung mặt THẬT từ bộ dò là hình vuông (đo trên 13 lượt chấm công thật), nên ca mẫu dùng khung vuông.
    const r = chestRect(IMG_W, IMG_H, [540, 170, 200, 200]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // rộng 1,6×200 = 320; cao 1,05×200 = 210; trái = 640 − 160 = 480; trên = 170 + 1,05×200 = 380
    expect(r.rect).toEqual({ left: 480, top: 380, width: 320, height: 210 });
    expect(r.coverage).toBeCloseTo(1, 2);
  });

  it("CHEST_ROOM_NEEDED luôn đúng bằng chỗ vùng áo cần dưới cằm — cổng kiosk dùng chính số này", () => {
    expect(CHEST_ROOM_NEEDED).toBeCloseTo(SHIRT_CROP.topOffset + SHIRT_CROP.heightFactor - 1, 10);
    // Đủ chỗ theo cổng ⇒ cắt được trọn vẹn. Trước v1.21.1 cổng đòi 1,1 mà vùng cắt cần 1,2 nên 5/13 ảnh bị cắt hụt đáy.
    for (const h of [180, 200, 230, 258, 300]) {
      const y = Math.floor(IMG_H - (1 + CHEST_ROOM_NEEDED) * h); // vừa đủ chỗ theo cổng
      const r = chestRect(IMG_W, IMG_H, [540, y, h, h]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.coverage).toBeGreaterThan(0.99); // không bị kẹp đáy
    }
  });

  it("13 khung mặt THẬT của phòng khám (01–02/10/2026) đều cắt trọn, không tràn đáy", () => {
    const that: FaceBox[] = [
      [538, 286, 202, 202], [512, 230, 211, 211], [543, 122, 249, 249], [507, 282, 186, 186],
      [583, 155, 258, 258], [489, 140, 258, 258], [528, 160, 231, 232], [514, 214, 222, 222],
      [525, 163, 255, 255], [535, 173, 223, 222], [513, 190, 243, 244], [570, 202, 241, 241],
      [539, 182, 228, 228],
    ];
    for (const box of that) {
      const r = chestRect(IMG_W, IMG_H, box);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.coverage).toBeGreaterThan(0.99);
      expect(r.rect.top + r.rect.height).toBeLessThanOrEqual(IMG_H);
      expect(r.rect.top).toBeGreaterThanOrEqual(box[1] + box[3]); // vẫn dưới cằm
    }
  });

  it("khung hình DỌC (tablet 720×1280) cũng đúng luật, dư chỗ hơn hẳn khung ngang", () => {
    const r = chestRect(720, 1280, [250, 300, 220, 220]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coverage).toBeCloseTo(1, 2);
    expect(r.rect.top).toBeGreaterThanOrEqual(520); // dưới cằm
  });

  it("mặt sát đáy khung → không đủ chỗ cho áo, báo CROP_OUT_OF_FRAME", () => {
    const r = chestRect(IMG_W, IMG_H, [540, 450, 200, 250]); // cằm ở 700, còn 20 px
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("CROP_OUT_OF_FRAME");
    expect(r.coverage).toBeLessThan(SHIRT_CROP.minCoverage);
  });

  it("mặt quá nhỏ → vùng áo nhỏ hơn 96 px, báo CROP_TOO_SMALL", () => {
    const r = chestRect(IMG_W, IMG_H, [600, 100, 60, 75]); // rộng 96, cao 64 → cạnh nhỏ nhất 64
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("CROP_TOO_SMALL");
  });

  it("mặt lệch sát mép trái → bị kẹp nhưng vẫn đủ dùng", () => {
    const r = chestRect(IMG_W, IMG_H, [10, 150, 220, 260]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rect.left).toBe(0); // kẹp vào mép ảnh, không âm
    expect(r.rect.left + r.rect.width).toBeLessThanOrEqual(IMG_W);
    expect(r.coverage).toBeGreaterThanOrEqual(SHIRT_CROP.minCoverage);
  });

  it("vùng cắt luôn nằm trong ảnh và KHÔNG giao khung mặt (bất biến: ảnh vùng áo không có mặt)", () => {
    // 200 khung mặt rải khắp ảnh, đủ mọi kích cỡ
    for (let i = 0; i < 200; i++) {
      const fw = 80 + ((i * 37) % 420);
      const fh = Math.round(fw * 1.25);
      const fx = (i * 53) % Math.max(1, IMG_W - fw);
      const fy = (i * 29) % Math.max(1, IMG_H - fh);
      const box: FaceBox = [fx, fy, fw, fh];
      const r = chestRect(IMG_W, IMG_H, box);
      if (!r.ok) continue;
      expect(r.rect.left).toBeGreaterThanOrEqual(0);
      expect(r.rect.top).toBeGreaterThanOrEqual(0);
      expect(r.rect.left + r.rect.width).toBeLessThanOrEqual(IMG_W);
      expect(r.rect.top + r.rect.height).toBeLessThanOrEqual(IMG_H);
      // mép trên vùng áo phải nằm dưới cằm
      expect(r.rect.top).toBeGreaterThanOrEqual(fy + fh);
    }
  });

  it("kích thước ảnh hoặc khung mặt vô lý → ném lỗi rõ ràng", () => {
    expect(() => chestRect(0, IMG_H, [10, 10, 100, 120])).toThrow(/ảnh/i);
    expect(() => chestRect(IMG_W, IMG_H, [10, 10, 0, 120])).toThrow(/khung mặt/i);
    expect(() => chestRect(IMG_W, IMG_H, [10, 10, 100, -5])).toThrow(/khung mặt/i);
  });

  it("chỉnh tỉ lệ thì vùng cắt đổi theo (để hiệu chỉnh sau khi chạy thử)", () => {
    const box: FaceBox = [540, 170, 200, 250];
    const rong = chestRect(IMG_W, IMG_H, box, { ...SHIRT_CROP, widthFactor: 2.2 });
    const cao = chestRect(IMG_W, IMG_H, box, { ...SHIRT_CROP, heightFactor: 0.5 });
    expect(rong.ok && rong.rect.width).toBe(440);
    expect(cao.ok && cao.rect.height).toBe(125);
    // Hạ mép trên vẫn phải nằm dưới cằm (giữ bất biến "không có mặt")
    const sat = chestRect(IMG_W, IMG_H, box, { ...SHIRT_CROP, topOffset: 1.02 });
    expect(sat.ok && sat.rect.top).toBeGreaterThanOrEqual(box[1] + box[3]);
  });

  it("dải giữa hẹp hơn và nằm trong vùng áo", () => {
    const r = chestRect(IMG_W, IMG_H, [540, 170, 200, 250]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const band = centerBand(r.rect);
    expect(band.width).toBe(224); // 70% của 320
    expect(band.left).toBeGreaterThan(r.rect.left);
    expect(band.left + band.width).toBeLessThanOrEqual(r.rect.left + r.rect.width);
    expect(band.top).toBe(r.rect.top);
    expect(band.height).toBe(r.rect.height);
  });
});
