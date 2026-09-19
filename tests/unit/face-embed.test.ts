import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alignFace,
  ARCFACE_TEMPLATE,
  embedFromSnapshot,
  faceModelPath,
  FACE_SIZE,
  l2normalize,
  similarityTransform,
  validateLandmarks,
  __setFaceEmbedTestHook,
  type Landmarks5,
  type Pt,
} from "@/lib/face-embed";

const apply = (A: [[number, number], [number, number]], t: Pt, p: Pt): Pt => [A[0][0] * p[0] + A[0][1] * p[1] + t[0], A[1][0] * p[0] + A[1][1] * p[1] + t[1]];

describe("căn chỉnh mặt theo 5 điểm mốc (ArcFace)", () => {
  it("ước lượng đúng phép tương tự: xoay 20°, phóng 3.7 lần, tịnh tiến (300, 150)", () => {
    const th = (20 * Math.PI) / 180, s = 3.7;
    const A0: [[number, number], [number, number]] = [[s * Math.cos(th), -s * Math.sin(th)], [s * Math.sin(th), s * Math.cos(th)]];
    const t0: Pt = [300, 150];
    // src = ảnh của mẫu qua phép biến đổi; hàm phải tìm được phép NGƯỢC đưa src về mẫu.
    const src = ARCFACE_TEMPLATE.map((p) => apply(A0, t0, p)) as Landmarks5;
    const { A, t } = similarityTransform(src, ARCFACE_TEMPLATE);
    for (let i = 0; i < 5; i++) {
      const q = apply(A, t, src[i]);
      expect(q[0]).toBeCloseTo(ARCFACE_TEMPLATE[i][0], 6);
      expect(q[1]).toBeCloseTo(ARCFACE_TEMPLATE[i][1], 6);
    }
  });

  it("5 điểm nhiễu: nghiệm bình phương tối thiểu, sai số nhỏ và không phản chiếu", () => {
    const src = ARCFACE_TEMPLATE.map(([x, y], i) => [2 * x + 40 + (i % 2 ? 1.5 : -1.5), 2 * y + 20 + (i % 3 ? -1 : 1)]) as Landmarks5;
    const { A, t } = similarityTransform(src, ARCFACE_TEMPLATE);
    expect(A[0][0] * A[1][1] - A[0][1] * A[1][0]).toBeGreaterThan(0); // định thức dương => không lật gương
    const err = src.map((p, i) => Math.hypot(...(apply(A, t, p).map((v, k) => v - ARCFACE_TEMPLATE[i][k]) as [number, number])));
    expect(Math.max(...err)).toBeLessThan(2);
  });

  it("alignFace: ảnh 224×224 chứa mẫu phóng 2 lần => cắt về 112×112, pixel khớp vị trí, chuẩn hóa (x−127.5)/127.5", () => {
    const W = 224, H = 224;
    const raw = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      raw[(y * W + x) * 3] = x; // R = x
      raw[(y * W + x) * 3 + 1] = y; // G = y
      raw[(y * W + x) * 3 + 2] = 0;
    }
    const src = ARCFACE_TEMPLATE.map(([x, y]) => [2 * x, 2 * y]) as Landmarks5;
    const out = alignFace(raw, W, H, src);
    expect(out.length).toBe(3 * FACE_SIZE * FACE_SIZE);
    // Điểm (56, 71) trên ảnh đích ứng với (112, 142) trên ảnh nguồn: R=112, G=142.
    const idx = 71 * FACE_SIZE + 56;
    expect(out[idx] * 127.5 + 127.5).toBeCloseTo(112, 0);
    expect(out[FACE_SIZE * FACE_SIZE + idx] * 127.5 + 127.5).toBeCloseTo(142, 0);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  it("validateLandmarks: ngoài ảnh hoặc mặt quá nhỏ bị từ chối", () => {
    const ok: Landmarks5 = [[100, 100], [160, 100], [130, 140], [105, 180], [155, 180]];
    expect(validateLandmarks(ok, 640, 480)).toBeNull();
    expect(validateLandmarks([[-1, 100], [160, 100], [130, 140], [105, 180], [155, 180]], 640, 480)).toMatch(/ngoài ảnh/);
    expect(validateLandmarks([[100, 100], [110, 100], [105, 110], [100, 120], [110, 120]], 640, 480)).toMatch(/quá nhỏ/);
  });

  it("l2normalize cho vector đơn vị", () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });
});

describe.skipIf(!existsSync(faceModelPath()))("mô hình InsightFace (ONNX) thật", () => {
  it("cùng một ảnh => cosine 1; hai ảnh khác nhau => vector khác; embedding 512 chiều chuẩn hóa", async () => {
    __setFaceEmbedTestHook(null);
    const { default: sharp } = await import("sharp");
    const mk = (seed: number) => {
      const W = 320, H = 240, buf = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        buf[i] = (x * seed) & 255; buf[i + 1] = (y * 3 + seed * 40) & 255; buf[i + 2] = ((x ^ y) * seed) & 255;
      }
      return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
    };
    const pts: Landmarks5 = [[120, 90], [200, 90], [160, 140], [130, 180], [190, 180]];
    const [a, b] = await Promise.all([mk(1), mk(7)]);
    const ea = (await embedFromSnapshot(a, pts)).embedding;
    const ea2 = (await embedFromSnapshot(a, pts)).embedding;
    const eb = (await embedFromSnapshot(b, pts)).embedding;
    const cos = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(ea.length).toBe(512);
    expect(cos(ea, ea)).toBeCloseTo(1, 5);
    expect(cos(ea, ea2)).toBeCloseTo(1, 5);
    expect(cos(ea, eb)).toBeLessThan(0.95);
  });
});
