// QC adversarial unit tests — v1.3: mô hình InsightFace thật (bỏ qua nếu thiếu models/), validateLandmarks, cooldown kiosk.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  __setFaceEmbedTestHook,
  alignFace,
  alignResidual,
  ARCFACE_TEMPLATE,
  embedFromSnapshot,
  FaceInputError,
  faceModelPath,
  MAX_ALIGN_RESIDUAL,
  similarityTransform,
  validateLandmarks,
  type Landmarks5,
} from "@/lib/face-embed";
import {
  cooldownStep,
  DIFFERENT_FRAMES,
  DIFFERENT_RATIO,
  isDifferentPosition,
  MAX_COOLDOWN_MS,
  SIZE_RATIO,
  startCooldown,
  type Box,
} from "@/lib/face/cooldown";

const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

describe("validateLandmarks / similarityTransform: biên", () => {
  it("x = W, y = H đúng biên => hợp lệ; W+0.001 => ngoài ảnh; mắt cách 19.99 => quá nhỏ; 20 => hợp lệ", () => {
    expect(validateLandmarks([[600, 440], [640, 440], [620, 460], [600, 480], [640, 480]], 640, 480)).toBeNull();
    expect(validateLandmarks([[600, 440], [640.001, 440], [620, 460], [600, 480], [640, 480]], 640, 480)).toMatch(/ngoài ảnh/);
    expect(validateLandmarks([[100, 100], [119.99, 100], [110, 120], [100, 140], [120, 140]], 640, 480)).toMatch(/quá nhỏ/);
    expect(validateLandmarks([[100, 100], [120, 100], [110, 120], [100, 140], [120, 140]], 640, 480)).toBeNull();
  });

  it("NaN / Infinity / -0 trong điểm mốc", () => {
    expect(validateLandmarks([[NaN, 100], [160, 100], [130, 140], [105, 180], [155, 180]], 640, 480)).toMatch(/ngoài ảnh/);
    expect(validateLandmarks([[100, 100], [Infinity, 100], [130, 140], [105, 180], [155, 180]], 640, 480)).toMatch(/ngoài ảnh/);
    expect(validateLandmarks([[-0, 100], [160, 100], [130, 140], [105, 180], [155, 180]], 640, 480)).toBeNull();
  });

  it("5 điểm trùng nhau => similarityTransform ném lỗi (không NaN âm thầm); mắt xa nhưng 3 điểm còn lại trùng => vẫn tính được", () => {
    const same: Landmarks5 = [[10, 10], [10, 10], [10, 10], [10, 10], [10, 10]];
    expect(() => similarityTransform(same, [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2]])).toThrow();
    const pts: Landmarks5 = [[100, 100], [160, 100], [130, 130], [130, 130], [130, 130]];
    const { A, t } = similarityTransform(pts, [[38.3, 51.7], [73.5, 51.5], [56, 71.7], [41.5, 92.4], [70.7, 92.2]]);
    for (const v of [...A.flat(), ...t]) expect(Number.isFinite(v)).toBe(true);
  });

  it("alignFace: điểm mốc ở biên ảnh 40×40 => không ném lỗi, pixel ngoài ảnh = đen (−1)", () => {
    const raw = new Uint8Array(40 * 40 * 3).fill(255);
    const out = alignFace(raw, 40, 40, [[0, 0], [40, 0], [20, 20], [0, 40], [40, 40]]);
    expect(out.length).toBe(3 * 112 * 112);
    expect(out.every((v) => v >= -1 && v <= 1)).toBe(true);
    expect(out.some((v) => v === -1)).toBe(true); // vùng ngoài ảnh
    expect(out.some((v) => v > 0.99)).toBe(true); // vùng trong ảnh (trắng)
  });
});

describe.skipIf(!existsSync(faceModelPath()))("mô hình InsightFace thật với samples.jpg (1280×1158, nhiều mặt thật)", () => {
  const jpeg = readFileSync(join(process.cwd(), "node_modules", "@vladmandic", "human", "assets", "samples.jpg"));
  const F1: Landmarks5 = [[305, 530], [333, 527], [322, 545], [310, 557], [337, 555]];
  const F1_JIT: Landmarks5 = [[307, 531], [335, 528], [323, 546], [311, 558], [338, 556]];
  const F2: Landmarks5 = [[557, 517], [587, 520], [570, 540], [560, 557], [583, 555]];
  const BG: Landmarks5 = [[900, 300], [940, 300], [920, 330], [905, 355], [935, 355]];
  const SWAP_EYES: Landmarks5 = [F1[1], F1[0], F1[2], F1[3], F1[4]];
  const MIRROR: Landmarks5 = [F1[1], F1[0], F1[2], F1[4], F1[3]];
  const e = async (p: Landmarks5) => (await embedFromSnapshot(jpeg, p)).embedding;
  __setFaceEmbedTestHook(null);
  afterAll(() => __setFaceEmbedTestHook(null));

  it("embedding 512 chiều, chuẩn L2 = 1, xác định (2 lần giống hệt), F1 ≠ F2, F1 ≈ F1 lệch 1–2px", async () => {
    const [a, a2, b, j] = [await e(F1), await e(F1), await e(F2), await e(F1_JIT)];
    expect(a.length).toBe(512);
    expect(norm(a)).toBeCloseTo(1, 5);
    expect(Array.from(a)).toEqual(Array.from(a2));
    const same = cos(a, j), diff = cos(a, b);
    console.log(`[qc-face] cos(F1, F1 lệch 2px)=${same.toFixed(3)}  cos(F1, F2)=${diff.toFixed(3)}`);
    expect(same).toBeGreaterThan(0.6);
    expect(diff).toBeLessThan(0.45); // dưới ngưỡng mặc định
  });

  it("điểm mốc vào vùng nền (không có mặt) => vẫn trả embedding chuẩn, không ném lỗi; không giống F1/F2", async () => {
    const bg = await e(BG);
    expect(bg.length).toBe(512);
    expect(norm(bg)).toBeCloseTo(1, 5);
    const [a, b] = [await e(F1), await e(F2)];
    console.log(`[qc-face] cos(BG, F1)=${cos(bg, a).toFixed(3)}  cos(BG, F2)=${cos(bg, b).toFixed(3)}`);
    expect(Math.max(cos(bg, a), cos(bg, b))).toBeLessThan(0.45);
  });

  it("đảo mắt trái/phải hoặc lật gương (kiosk gửi sai thứ tự) => sai số căn chỉnh > 12px => FaceInputError, không ra embedding", async () => {
    // Umeyama không phản chiếu: đảo mắt tương đương xoay ~180° => mặt lộn ngược => residual lớn. (Tại 18a5f80 vẫn ra embedding, cosine với F1 ≈ 0.06.)
    const res = (p: Landmarks5) => {
      const { A, t } = similarityTransform(p, ARCFACE_TEMPLATE);
      return alignResidual(p, A, t);
    };
    console.log(`[qc-face] residual F1=${res(F1).toFixed(2)}  đảo mắt=${res(SWAP_EYES).toFixed(2)}  lật gương=${res(MIRROR).toFixed(2)}  nền=${res(BG).toFixed(2)}`);
    expect(res(F1)).toBeLessThan(MAX_ALIGN_RESIDUAL);
    await expect(e(SWAP_EYES)).rejects.toThrow(FaceInputError);
    await expect(e(SWAP_EYES)).rejects.toThrow(/bố cục/);
    await expect(e(MIRROR)).rejects.toThrow(/bố cục/);
  });

  it("biên residual: điểm mốc thật xê dịch ±3px vẫn qua; mũi kéo lệch 40px (mặt méo) thì bị chặn", async () => {
    const jitter: Landmarks5 = [[302, 533], [336, 524], [325, 542], [307, 560], [340, 552]];
    expect(norm(await e(jitter))).toBeCloseTo(1, 5);
    const broken: Landmarks5 = [F1[0], F1[1], [F1[2][0] + 40, F1[2][1] + 40], F1[3], F1[4]];
    await expect(e(broken)).rejects.toThrow(/bố cục/);
  });

  it("mắt cách 10px => ném 'Mặt quá nhỏ'; điểm ngoài ảnh => 'Điểm mốc'; điểm ở 4 góc ảnh => vẫn trả embedding", async () => {
    await expect(e([[320, 530], [330, 530], [325, 540], [320, 550], [330, 550]])).rejects.toThrow(/quá nhỏ/);
    await expect(e([[320, 530], [1280.5, 530], [325, 540], [320, 550], [330, 550]])).rejects.toThrow(/Điểm mốc/);
    const tl = await e([[0, 0], [40, 0], [20, 30], [0, 60], [40, 60]]);
    const br = await e([[1240, 1118], [1280, 1118], [1260, 1148], [1240, 1158], [1280, 1158]]);
    expect(norm(tl)).toBeCloseTo(1, 5);
    expect(norm(br)).toBeCloseTo(1, 5);
  });

  it("5 điểm thẳng hàng (mắt–mũi–miệng cùng một đường) => không phải bố cục mặt => FaceInputError (không NaN)", async () => {
    await expect(e([[300, 500], [340, 500], [320, 500], [310, 500], [330, 500]])).rejects.toThrow(FaceInputError);
  });

  it("JPEG hỏng (magic đúng, dữ liệu rác) / PNG bytes => FaceInputError (route trả 400, không 503)", async () => {
    const bad = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
    await expect(embedFromSnapshot(bad, F1)).rejects.toThrow(FaceInputError);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await expect(embedFromSnapshot(png, F1)).rejects.toThrow(FaceInputError);
  });

  it("ảnh 6000×6000 (JPEG 206 KB, raw 108 MB) => 'Snapshot quá lớn' NGAY từ metadata (< 500 ms, không giải mã)", async () => {
    const { default: sharp } = await import("sharp");
    const big = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg({ quality: 50 }).toBuffer();
    expect(big.length).toBeLessThan(1024 * 1024);
    const t0 = Date.now();
    await expect(embedFromSnapshot(big, F1)).rejects.toThrow(/quá lớn/);
    const ms = Date.now() - t0;
    console.log(`[qc-face] từ chối 6000×6000 sau ${ms} ms`);
    expect(ms).toBeLessThan(500);
  }, 60_000);

  it("biên kích thước: 1920×1080 chấp nhận, 1921×1080 từ chối; ảnh 1×1 => 'quá nhỏ' (không crash)", async () => {
    const { default: sharp } = await import("sharp");
    const mk = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 80, b: 70 } } }).jpeg().toBuffer();
    const pts: Landmarks5 = [[900, 500], [980, 500], [940, 550], [905, 600], [975, 600]];
    expect(norm((await embedFromSnapshot(await mk(1920, 1080), pts)).embedding)).toBeCloseTo(1, 5);
    await expect(embedFromSnapshot(await mk(1921, 1080), pts)).rejects.toThrow(/quá lớn/);
    await expect(embedFromSnapshot(await mk(1, 1), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 0]])).rejects.toThrow(/quá nhỏ/);
  });

  it("validateLandmarks + faceBox: nới 15% biên; mắt 0.15w–0.8w", () => {
    const pts: Landmarks5 = [[100, 100], [160, 100], [130, 140], [105, 180], [155, 180]];
    expect(validateLandmarks(pts, 640, 480, [90, 80, 100, 120])).toBeNull(); // eye 60 ∈ [15, 80]
    expect(validateLandmarks(pts, 640, 480, [100, 100, 60, 100])).toMatch(/kích thước khung/); // 60 > 0.8×60
    expect(validateLandmarks(pts, 640, 480, [0, 0, 500, 500])).toMatch(/kích thước khung/); // 60 < 0.15×500
    expect(validateLandmarks(pts, 640, 480, [116, 100, 100, 100])).toMatch(/ngoài khung/); // x=100 < 116−15 = 101
    expect(validateLandmarks(pts, 640, 480, [115, 100, 100, 100])).toBeNull(); // x=100 = 115−15 => đúng biên nới, chấp nhận
    expect(validateLandmarks(pts, 640, 480, null)).toBeNull();
  });
});

describe("cooldown kiosk: biên DIFFERENT_RATIO, khung rộng 0", () => {
  const last: Box = [400, 100, 300, 300]; // tâm (550, 250)
  const shifted = (dx: number, dy = 0): Box => [400 + dx, 100 + dy, 300, 300];

  it("lệch đúng bằng 0.6 × w (180px) => KHÔNG khác vị trí (so sánh chặt); 180 + ε => khác", () => {
    const d = DIFFERENT_RATIO * 300;
    expect(isDifferentPosition(last, shifted(d))).toBe(false);
    expect(isDifferentPosition(last, shifted(d + 1e-9))).toBe(true);
    expect(isDifferentPosition(last, shifted(-d))).toBe(false);
    expect(isDifferentPosition(last, shifted(0, d + 0.001))).toBe(true);
    // đường chéo: dx = dy = 127 => hypot ≈ 179.6 < 180 cùng chỗ; 128 => 181 khác chỗ
    expect(isDifferentPosition(last, shifted(127, 127))).toBe(false);
    expect(isDifferentPosition(last, shifted(128, 128))).toBe(true);
  });

  it("lệch theo tỉ lệ bề rộng khung CŨ: khung mới cùng cỡ lệch 160 => cùng chỗ; khung 20px (đổi cỡ > 45%) => khác", () => {
    expect(isDifferentPosition(last, [560, 100, 300, 300])).toBe(false); // lệch 160 < 180, cùng cỡ
    const small: Box = [700, 250, 20, 20]; // lệch 160 nhưng bề rộng 20 vs 300 => SIZE_RATIO
    expect(isDifferentPosition(last, small)).toBe(true);
  });

  it("biên SIZE_RATIO: |w' − w| = 0.45w (135px) => cùng cỡ; 135 + ε => khác (cả to lên lẫn nhỏ đi)", () => {
    const d = SIZE_RATIO * 300;
    expect(isDifferentPosition(last, [400 - d / 2, 100, 300 + d, 300])).toBe(false);
    expect(isDifferentPosition(last, [400 - d / 2, 100, 300 + d + 1e-6, 300])).toBe(true);
    expect(isDifferentPosition(last, [400 + d / 2, 100, 300 - d, 300])).toBe(false);
    expect(isDifferentPosition(last, [400 + d / 2, 100, 300 - d - 1e-6, 300])).toBe(true);
    // chỉ so bề rộng, không so chiều cao
    expect(isDifferentPosition(last, [400, -200, 300, 900])).toBe(false);
  });

  it("lastBox rộng 0 (khung suy biến): bề rộng chuẩn = 1px => mọi khung kể cả trùng hệt (w=0: |0−1| > 0.45) đều 'khác' => thoát sau 3 khung", () => {
    const zero: Box = [400, 100, 0, 0];
    expect(isDifferentPosition(zero, [400, 100, 0, 0])).toBe(true);
    expect(isDifferentPosition(zero, [400.5, 100, 0, 0])).toBe(true);
    expect(isDifferentPosition(zero, [400, 100, 2, 2])).toBe(true);
    expect(isDifferentPosition(zero, [400, 100, 1, 0])).toBe(false); // khung 1px lệch tâm 0.5 ≤ 0.6, cùng cỡ 1px
    expect(isDifferentPosition([400, 100, -50, 10], [374.5, 100, 1, 10])).toBe(false); // bề rộng âm => chuẩn 1px; tâm trùng (375, 105)
    let s = startCooldown(zero, 0);
    let done = false;
    for (let i = 0; i < DIFFERENT_FRAMES; i++) ({ state: s, done } = cooldownStep(s, { faceCount: 1, box: zero, now: i * 100 }));
    expect(done).toBe(true);
  });

  it("MAX_COOLDOWN_MS: cùng người đứng yên, khung thứ n tại đúng 5000 ms => done; 4999 ms => chưa", () => {
    const s = startCooldown(last, 1000);
    expect(cooldownStep(s, { faceCount: 1, box: last, now: 1000 + MAX_COOLDOWN_MS - 1 }).done).toBe(false);
    expect(cooldownStep(s, { faceCount: 1, box: last, now: 1000 + MAX_COOLDOWN_MS }).done).toBe(true);
    // kể cả 2 mặt / không mặt: hết hạn vẫn done
    expect(cooldownStep(s, { faceCount: 2, box: null, now: 1000 + MAX_COOLDOWN_MS }).done).toBe(true);
  });

  it("khung NaN => không bao giờ được coi là 'khác vị trí' (cooldown chỉ thoát khi vắng mặt hoặc hết 5 s)", () => {
    const nan: Box = [NaN, NaN, NaN, NaN];
    expect(isDifferentPosition(last, nan)).toBe(false);
    let s = startCooldown(last, 0);
    for (let i = 0; i < DIFFERENT_FRAMES + 2; i++) {
      const r = cooldownStep(s, { faceCount: 1, box: nan, now: i * 100 });
      s = r.state;
      expect(r.done).toBe(false);
    }
    expect(cooldownStep(s, { faceCount: 1, box: nan, now: MAX_COOLDOWN_MS }).done).toBe(true);
  });

  it("đếm 'khác vị trí' bị reset khi xen một khung cùng chỗ hoặc một khung 2 mặt", () => {
    const other = shifted(250);
    let s = startCooldown(last, 0);
    s = cooldownStep(s, { faceCount: 1, box: other, now: 0 }).state;
    s = cooldownStep(s, { faceCount: 1, box: other, now: 100 }).state;
    expect(s.differentFrames).toBe(2);
    s = cooldownStep(s, { faceCount: 2, box: other, now: 200 }).state;
    expect(s.differentFrames).toBe(0);
    s = cooldownStep(s, { faceCount: 1, box: other, now: 300 }).state;
    s = cooldownStep(s, { faceCount: 1, box: other, now: 400 }).state;
    const r = cooldownStep(s, { faceCount: 1, box: other, now: 500 });
    expect(r.done).toBe(true);
  });

  it("startCooldown sao chép khung (mutating box gốc không ảnh hưởng state)", () => {
    const b: Box = [1, 2, 3, 4];
    const s = startCooldown(b, 0);
    b[0] = 999;
    expect(s.lastBox).toEqual([1, 2, 3, 4]);
  });
});
