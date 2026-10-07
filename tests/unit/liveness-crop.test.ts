// v1.22.0: vùng cắt đưa vào mô hình chống giả mạo L2 — hệ số cắt là thứ quyết định mô hình đọc ra "người thật" hay "ảnh in".
import { describe, expect, it } from "vitest";
import { cropRegion, MINIFASNET_SCALE, type FaceBox } from "@/lib/liveness-l2";

const W = 1280;
const H = 720;
// Khung mặt THẬT từ bộ dò BlazeFace: hình vuông, rộng hơn khung của bộ dò trong mã tham chiếu.
const BOX: FaceBox = [525, 163, 255, 255];

describe("cropRegion — vùng cắt cho L2", () => {
  it("hệ số mặc định là 2,7 theo mã tham chiếu", () => {
    expect(MINIFASNET_SCALE).toBe(2.7);
  });

  it("cắt đúng gấp `scale` lần khung mặt và giữ nguyên tâm", () => {
    const r = cropRegion(W, H, BOX, 1.2);
    expect(r.width).toBeGreaterThanOrEqual(Math.floor(255 * 1.2) - 2);
    expect(r.width).toBeLessThanOrEqual(Math.ceil(255 * 1.2) + 2);
    // tâm vùng cắt trùng tâm khuôn mặt (sai số làm tròn 1 px)
    expect(Math.abs(r.left + r.width / 2 - (BOX[0] + BOX[2] / 2))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(r.top + r.height / 2 - (BOX[1] + BOX[3] / 2))).toBeLessThanOrEqual(1.5);
  });

  it("hệ số càng lớn vùng cắt càng rộng — mặt chiếm phần càng nhỏ trong ô 80×80", () => {
    const nho = cropRegion(W, H, BOX, 1.2);
    const vua = cropRegion(W, H, BOX, 2.0);
    const to = cropRegion(W, H, BOX, MINIFASNET_SCALE);
    expect(nho.width).toBeLessThan(vua.width);
    expect(vua.width).toBeLessThan(to.width);
    // Tỉ lệ mặt / vùng cắt: 1,2 cho mặt chiếm ~69 % bề ngang, 2,7 chỉ còn ~37 %.
    expect(BOX[2] / nho.width).toBeGreaterThan(0.6);
    expect(BOX[2] / to.width).toBeLessThan(0.45);
  });

  it("luôn nằm trong ảnh, kể cả khi mặt sát mép", () => {
    for (const box of [[0, 0, 200, 200], [W - 210, H - 210, 200, 200], [600, 10, 300, 300]] as FaceBox[]) {
      for (const sc of [1.2, 2.0, MINIFASNET_SCALE, 3.5]) {
        const r = cropRegion(W, H, box, sc);
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(W);
        expect(r.top + r.height).toBeLessThanOrEqual(H);
        expect(Math.min(r.width, r.height)).toBeGreaterThan(0);
      }
    }
  });

  it("khung mặt không hợp lệ thì báo lỗi rõ ràng", () => {
    expect(() => cropRegion(W, H, [10, 10, 0, 100], 2)).toThrow("Khung mặt không hợp lệ");
  });
});
