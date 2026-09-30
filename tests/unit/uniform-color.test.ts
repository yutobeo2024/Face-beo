// v1.20.0: đặc trưng màu vùng áo — hàm thuần trên mảng pixel, không cần ảnh thật.
import { describe, expect, it } from "vitest";
import { HIST_SIZE, brightnessStats, colorHistogram, grayWorldGains, histSimilarity, meanColorHex, rgbToHsv, skinRatio } from "@/lib/uniform-color";

/** Mảng pixel RGB phẳng của một vùng đơn sắc, có thể thêm nhiễu nhẹ cho giống ảnh thật. */
function solid(r: number, g: number, b: number, n = 400, noise = 0): number[] {
  const px: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = noise ? ((i * 37) % (noise * 2)) - noise : 0;
    px.push(Math.max(0, Math.min(255, r + d)), Math.max(0, Math.min(255, g + d)), Math.max(0, Math.min(255, b + d)));
  }
  return px;
}
const sim = (a: number[], b: number[], ga?: [number, number, number], gb?: [number, number, number]) =>
  histSimilarity(colorHistogram(a, ga)!, colorHistogram(b, gb)!);

const NAVY = solid(30, 45, 95, 400, 8);
const DO = solid(170, 40, 40, 400, 8);
const TRANG = solid(225, 228, 232, 400, 6);
const XAM = solid(128, 130, 132, 400, 6);
const DEN = solid(35, 36, 38, 400, 6);

describe("biểu đồ màu vùng áo", () => {
  it("tự khớp với chính mình = 1, tổng luôn bằng 1", () => {
    const h = colorHistogram(NAVY)!;
    expect(h).not.toBeNull();
    expect(h.length).toBe(HIST_SIZE);
    expect([...h].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(histSimilarity(h, h)).toBeCloseTo(1, 6);
  });

  it("hai màu khác hẳn nhau → gần như không giống", () => {
    expect(sim(NAVY, DO)).toBeLessThan(0.1);
  });

  it("cùng màu áo nhưng chụp tối hơn hẳn vẫn khớp (bỏ kênh độ sáng)", () => {
    const toi = solid(15, 22, 47, 400, 8); // đúng sắc navy, sáng bằng một nửa
    expect(sim(NAVY, toi)).toBeGreaterThan(0.85);
  });

  it("TRẮNG – XÁM – ĐEN phải tách nhau (ca dễ vỡ nhất: áo trắng không có sắc màu)", () => {
    expect(sim(TRANG, DEN)).toBeLessThan(0.1);
    expect(sim(TRANG, XAM)).toBeLessThan(0.3);
    expect(sim(XAM, DEN)).toBeLessThan(0.3);
    expect(sim(TRANG, solid(230, 232, 235, 400, 6))).toBeGreaterThan(0.9); // hai áo trắng thì khớp
  });

  it("áo trắng không bị nhầm với áo có màu", () => {
    expect(sim(TRANG, NAVY)).toBeLessThan(0.1);
    expect(sim(TRANG, DO)).toBeLessThan(0.1);
  });

  it("đèn vàng làm lệch màu, cân bằng trắng kéo về khớp lại", () => {
    // Cách dùng đúng: hệ số tính trên TOÀN ảnh (có tường, da, tóc), rồi áp cho vùng áo.
    // Tính trên chính vùng áo đơn sắc là sai — gray-world sẽ kéo áo về xám, mất luôn sắc màu.
    const amVang = (px: number[]) => px.map((v, i) => Math.min(255, Math.round(v * (i % 3 === 2 ? 0.75 : 1.25))));
    const canh = [...solid(180, 178, 176, 600, 20), ...NAVY]; // nền tường + người mặc áo navy
    const aoAmVang = amVang(NAVY);
    expect(sim(NAVY, aoAmVang)).toBeLessThan(0.75); // chưa cân bằng thì lệch
    const g = grayWorldGains(amVang(canh));
    expect(sim(NAVY, aoAmVang, undefined, g)).toBeGreaterThan(0.85); // cân bằng xong thì khớp lại
  });

  it("vùng quá tối hoặc cháy sáng → trả null (không kết luận bừa)", () => {
    expect(colorHistogram(solid(3, 3, 4, 400))).toBeNull();
    expect(colorHistogram(solid(252, 253, 254, 400))).toBeNull();
    expect(colorHistogram([])).toBeNull();
  });

  it("độ sáng và tương phản đo đúng", () => {
    expect(brightnessStats(solid(0, 0, 0, 100)).mean).toBeCloseTo(0, 3);
    expect(brightnessStats(solid(255, 255, 255, 100)).mean).toBeCloseTo(1, 3);
    expect(brightnessStats(NAVY).mean).toBeLessThan(0.3); // đúng như ảnh chấm công thật
    expect(brightnessStats(solid(128, 128, 128, 100)).std).toBeCloseTo(0, 3);
    expect(brightnessStats(TRANG).std).toBeLessThan(0.1);
  });

  it("nhận ra vùng cắt trúng da người", () => {
    expect(skinRatio(solid(205, 160, 135, 200))).toBeGreaterThan(0.9);
    expect(skinRatio(NAVY)).toBeLessThan(0.05);
    expect(skinRatio(TRANG)).toBeLessThan(0.2);
  });

  it("đổi màu sang HSV đúng các mốc quen thuộc", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toMatchObject({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBeCloseTo(120, 3);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240, 3);
    expect(rgbToHsv({ r: 90, g: 90, b: 90 }).s).toBeCloseTo(0, 6);
  });

  it("ô màu hiển thị lấy đúng màu trung bình", () => {
    expect(meanColorHex(solid(255, 0, 0, 10))).toBe("#ff0000");
    expect(meanColorHex(solid(0, 0, 0, 10))).toBe("#000000");
  });
});
