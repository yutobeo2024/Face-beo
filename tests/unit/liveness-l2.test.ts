import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cropRegion, miniFasnetScore, modelPath, resizeBilinearCV, softmax } from "@/lib/liveness-l2";
import { l1Score } from "@/lib/liveness";

describe("L2 — tiền xử lý khớp mã tham chiếu Python", () => {
  it("cropRegion theo công thức _crop_face (hệ số 2.7, kẹp trong ảnh)", () => {
    // Ảnh 1280×1158, khung 200×200 tại (512,347): 540×540 quanh tâm (612,447)
    expect(cropRegion(1280, 1158, [512, 347, 200, 200])).toEqual({ left: 342, top: 177, width: 541, height: 541 });
    // Sát góc trái trên: bị kẹp về 0
    expect(cropRegion(1280, 1158, [0, 0, 90, 90])).toEqual({ left: 0, top: 0, width: 167, height: 167 });
    // Khung lớn hơn ảnh cho phép: hệ số tự giảm
    const r = cropRegion(640, 480, [100, 50, 400, 400]);
    expect(r.width).toBeLessThanOrEqual(640);
    expect(r.height).toBeLessThanOrEqual(480);
  });

  it("resizeBilinearCV thu nhỏ 4×4 → 2×2 như cv2 INTER_LINEAR (trung bình 2×2, không khử răng cưa rộng hơn)", () => {
    const src = Uint8Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);
    expect(Array.from(resizeBilinearCV(src, 4, 4, 2, 2, 1))).toEqual([25, 45, 105, 125]);
  });

  it("softmax + L1", () => {
    const p = softmax([1, 3, 1]);
    expect(p[1]).toBeGreaterThan(0.7);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(l1Score([{ real: 0.9, live: 0.9 }])).toBeCloseTo(0.9);
    expect(l1Score([{ real: 0.95, live: 0.1 }])).toBeCloseTo(0.35); // một mô-đun thấp kéo điểm xuống
  });
});

const sample = join(process.cwd(), "node_modules", "@vladmandic", "human", "assets", "samples.jpg");
describe.skipIf(!existsSync(modelPath()) || !existsSync(sample))("L2 — MiniFASNetV2 khớp onnxruntime Python + OpenCV", () => {
  // Giá trị chuẩn sinh bằng mã tham chiếu yakhyo/face-anti-spoofing (cv2.imread + _crop_face + cv2.resize).
  const REF: [number[], number][] = [
    [[128, 115, 120, 120], 0.7152],
    [[512, 347, 200, 200], 0.9998],
    [[0, 0, 90, 90], 0.0002],
    [[1024, 810, 160, 160], 0.9691],
    [[25, 926, 110, 110], 0.9403],
  ];
  it("xác suất 'thật' lệch < 0.01 so với bản tham chiếu", async () => {
    const jpeg = readFileSync(sample);
    for (const [box, want] of REF) {
      const r = await miniFasnetScore(jpeg, box as [number, number, number, number]);
      expect(Math.abs(r.real - want)).toBeLessThan(0.01);
      expect(r.probs).toHaveLength(3);
    }
  });
});
