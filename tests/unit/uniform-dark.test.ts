// v1.21.2: ảnh vùng áo TỐI THẬT của kiosk phải đi lọt CẢ hai cổng — trích đặc trưng lẫn bảng quyết định.
//
// Lỗi đã xảy ra: hạ QUALITY_LIMITS.minBrightness trong uniform-score.ts nhưng extractShirtFeature lại viết cứng 0,1,
// nên 5/13 ảnh thật vẫn bị loại oan. Bộ test này khóa hai chỗ lại với nhau.
import { describe, expect, it } from "vitest";
import { extractShirtFeature } from "@/lib/uniform";
import { decideUniform, QUALITY_LIMITS } from "@/lib/uniform-score";
import { SHIRT_CROP } from "@/lib/uniform-crop";

/** Ảnh 1280×720: tường tối, mặt, thân áo navy sẫm — dựng cho đúng độ sáng đo thật trên kiosk (0,06–0,10). */
async function darkSnapshot(shirtLevel: number) {
  const sharp = (await import("sharp")).default;
  const W = 1280;
  const H = 720;
  const px = new Uint8Array(W * H * 3);
  const noise = (i: number) => ((i * 2654435761) % 41) - 20;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      // áo navy sẫm: xanh trội hơn đỏ/lục nên vẫn còn màu để so, dù độ sáng rất thấp
      let c = { r: 46, g: 46, b: 50 }; // tường tối
      if (x >= 520 && x < 740 && y >= 160 && y < 380) c = { r: 120, g: 92, b: 78 }; // khuôn mặt
      else if (x >= 420 && x < 860 && y >= 395) c = { r: shirtLevel, g: shirtLevel + 6, b: shirtLevel + 34 };
      const d = noise(i);
      px[i] = Math.max(0, Math.min(255, c.r + d));
      px[i + 1] = Math.max(0, Math.min(255, c.g + d));
      px[i + 2] = Math.max(0, Math.min(255, c.b + d));
    }
  }
  return sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

const FACE: [number, number, number, number] = [520, 160, 220, 220]; // khung vuông như bộ dò thật

describe("ảnh tối thật của kiosk", () => {
  it("áo sẫm trong phòng thiếu sáng vẫn cắt được đặc trưng", async () => {
    const r = await extractShirtFeature(await darkSnapshot(16), FACE, { embedder: null, keepCrop: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // đúng dải đo thật trên kiosk
    expect(r.feature.quality.brightness).toBeGreaterThan(QUALITY_LIMITS.minBrightness);
    expect(r.feature.quality.brightness).toBeLessThan(0.12);
    expect(r.feature.colorHist.length).toBeGreaterThan(0);
    expect(r.feature.cropJpeg).toBeTruthy();
  });

  it("hai cổng dùng CHUNG ngưỡng: trích được thì bảng quyết định cũng không kêu TOO_DARK", async () => {
    const r = await extractShirtFeature(await darkSnapshot(16), FACE, { embedder: null, keepCrop: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = decideUniform({
      scores: [{ templateId: 1, name: "Áo navy", embedScore: 0.9, colorScore: 0.9, score: 0.9, sampleCount: 3, versionOk: true }],
      quality: r.feature.quality,
    });
    expect(d.reason).not.toBe("TOO_DARK");
    expect(d.reason).not.toBe("LOW_CONTRAST");
  });

  it("tối hẳn (gần như đen) thì vẫn bị chặn", async () => {
    const r = await extractShirtFeature(await darkSnapshot(2), FACE, { embedder: null, keepCrop: false });
    if (r.ok) expect(r.feature.quality.brightness).toBeGreaterThanOrEqual(QUALITY_LIMITS.minBrightness);
    else expect(r.reason).toBe("TOO_DARK");
  });

  it("vùng cắt vẫn nằm dưới cằm (không chứa khuôn mặt)", async () => {
    const r = await extractShirtFeature(await darkSnapshot(16), FACE, { embedder: null, keepCrop: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feature.rect.top).toBeGreaterThanOrEqual(FACE[1] + FACE[3]);
    expect(SHIRT_CROP.topOffset).toBeGreaterThanOrEqual(1);
  });
});
