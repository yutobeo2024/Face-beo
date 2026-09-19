"use client";
/**
 * Engine khuôn mặt phía trình duyệt dựa trên @vladmandic/human.
 * Kiosk chỉ phát hiện mặt, chấm liveness (antispoof + liveness) và lấy 5 điểm mốc từ facemesh;
 * embedding (InsightFace), so khớp danh tính và kết luận liveness cuối cùng đều thuộc về server (v1.3).
 * KHÔNG dùng tọa độ Z của mesh làm tiêu chí quyết định — chỉ tính "độ phẳng" để ghi log.
 */
import type { Config, FaceResult, Human as HumanT } from "@vladmandic/human";

let humanPromise: Promise<HumanT> | null = null;

const CONFIG: Partial<Config> = {
  modelBasePath: "/models/",
  backend: "webgl",
  debug: false,
  cacheSensitivity: 0, // luôn chạy lại mô hình để điểm liveness là của khung hiện tại
  filter: { enabled: true, equalization: false },
  face: {
    enabled: true,
    detector: { enabled: true, rotation: false, maxDetected: 3, minConfidence: 0.5, return: false },
    mesh: { enabled: true },
    iris: { enabled: false },
    attention: { enabled: false },
    description: { enabled: false }, // không dùng faceres nữa — embedding tính trên server
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true },
    gear: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
} as Partial<Config>;

export type EngineInfo = { backend: string; version: string; warmupMs: number };

/** Nạp mô hình và warm-up. WebGL, tự lùi về WASM nếu lỗi. */
export function loadEngine(onStatus?: (s: string) => void): Promise<HumanT> {
  humanPromise ??= (async () => {
    const { default: Human } = await import("@vladmandic/human");
    let human = new Human(CONFIG);
    try {
      onStatus?.("Đang khởi tạo WebGL…");
      await human.init();
      if (human.tf.getBackend() !== "webgl") throw new Error("WebGL không khả dụng");
    } catch {
      onStatus?.("WebGL lỗi, chuyển sang WASM…");
      human = new Human({ ...CONFIG, backend: "wasm" } as Partial<Config>);
      await human.init();
    }
    onStatus?.("Đang tải mô hình…");
    await human.load();
    const loaded = human.models.loaded().map((m) => m.toLowerCase());
    const missing = ["blazeface", "facemesh", "antispoof", "liveness"].filter((m) => !loaded.some((l) => l.includes(m)));
    if (missing.length) throw new Error(`Không tải được mô hình: ${missing.join(", ")} — kiểm tra thư mục public/models`);
    onStatus?.("Đang warm-up…");
    await human.warmup();
    return human;
  })().catch((e) => {
    humanPromise = null;
    throw e;
  });
  return humanPromise;
}

export function engineInfo(h: HumanT): { backend: string; version: string } {
  return { backend: String(h.tf.getBackend()), version: h.version };
}

export type Gate = {
  ok: boolean;
  reason: string | null;
  face: FaceResult | null;
  faceWidth: number;
  yawDeg: number;
  pitchDeg: number;
  brightness: number;
  sharpness: number;
};

const DEG = 180 / Math.PI;

/** Độ sáng trung bình và độ nét (phương sai Laplacian) của vùng mặt, tính trên ảnh thu nhỏ. */
export function measureQuality(video: HTMLVideoElement, box: [number, number, number, number], scratch: HTMLCanvasElement) {
  const S = 96;
  scratch.width = S;
  scratch.height = S;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  const [x, y, w, h] = box;
  ctx.drawImage(video, Math.max(0, x), Math.max(0, y), Math.max(1, w), Math.max(1, h), 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const g = new Float32Array(S * S);
  let sum = 0;
  for (let i = 0; i < S * S; i++) {
    const v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    g[i] = v;
    sum += v;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let yy = 1; yy < S - 1; yy++) {
    for (let xx = 1; xx < S - 1; xx++) {
      const i = yy * S + xx;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - S] - g[i + S];
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  }
  const mean = lapSum / n;
  return { brightness: sum / (S * S), sharpness: lapSq / n - mean * mean };
}

/**
 * Cổng chất lượng. Kiosk: mặt ≥180px, lệch ≤20°. Enroll: mặt ≥200px, đủ sáng, không nhòe.
 */
export function checkGate(
  faces: FaceResult[],
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  opts: { minFace: number; maxAngle: number; checkLight?: boolean },
): Gate {
  const base = { ok: false, face: null, faceWidth: 0, yawDeg: 0, pitchDeg: 0, brightness: 0, sharpness: 0 };
  const real = faces.filter((f) => f.faceScore > 0.6 || f.score > 0.6);
  if (real.length === 0) return { ...base, reason: "Hãy nhìn vào camera" };
  if (real.length > 1) return { ...base, reason: "Chỉ một người trước camera" };
  const f = real[0];
  const faceWidth = f.box[2];
  const yawDeg = (f.rotation?.angle.yaw ?? 0) * DEG;
  const pitchDeg = (f.rotation?.angle.pitch ?? 0) * DEG;
  const q = opts.checkLight ? measureQuality(video, f.box, scratch) : { brightness: 128, sharpness: 999 };
  const r = { ...base, face: f, faceWidth, yawDeg, pitchDeg, ...q };
  if (faceWidth < opts.minFace) return { ...r, reason: "Lại gần camera hơn" };
  if (Math.abs(yawDeg) > opts.maxAngle || Math.abs(pitchDeg) > opts.maxAngle) return { ...r, reason: "Nhìn thẳng vào camera" };
  if (opts.checkLight && q.brightness < 60) return { ...r, reason: "Thiếu sáng — bật thêm đèn" };
  if (opts.checkLight && q.brightness > 225) return { ...r, reason: "Quá chói — tránh ngược sáng" };
  if (opts.checkLight && q.sharpness < 35) return { ...r, reason: "Ảnh bị nhòe — giữ yên" };
  if (!f.mesh?.length) return { ...r, reason: "Đang phân tích…" };
  return { ...r, ok: true, reason: null };
}

/** Độ lệch chuẩn tọa độ Z của mesh — CHỈ ghi log, không dùng để quyết định. */
export function meshFlatness(f: FaceResult): number | undefined {
  const zs = f.meshRaw?.map((p) => p[2] ?? 0) ?? [];
  if (zs.length < 10) return undefined;
  const m = zs.reduce((s, z) => s + z, 0) / zs.length;
  return Math.sqrt(zs.reduce((s, z) => s + (z - m) ** 2, 0) / zs.length);
}

export type Landmarks5 = [[number, number], [number, number], [number, number], [number, number], [number, number]];

/**
 * 5 điểm mốc theo tọa độ video từ facemesh (MediaPipe): mắt bên trái ảnh (33/133), mắt bên phải ảnh (362/263), mũi (1),
 * khóe miệng trái (61), phải (291). Thứ tự khớp mẫu ArcFace phía server.
 */
export function landmarks5(f: FaceResult): Landmarks5 | null {
  const m = f.mesh;
  if (!m || m.length < 300) return null;
  const mid = (a: number, b: number): [number, number] => [(m[a][0] + m[b][0]) / 2, (m[a][1] + m[b][1]) / 2];
  return [mid(33, 133), mid(362, 263), [m[1][0], m[1][1]], [m[61][0], m[61][1]], [m[291][0], m[291][1]]];
}

/** Điểm mốc (tọa độ video) → tọa độ pixel của snapshot. */
export function landmarksToSnapshot(pts: Landmarks5, snap: { scale: number; width: number; height: number }): Landmarks5 {
  return pts.map(([x, y]) => [Math.min(snap.width, Math.max(0, x * snap.scale)), Math.min(snap.height, Math.max(0, y * snap.scale))]) as Landmarks5;
}

/** Snapshot toàn khung, tối đa 1280×720, JPEG chất lượng 0.7; tự hạ chất lượng nếu > 1MB. `scale` = tỉ lệ snapshot/video. */
export function captureSnapshot(video: HTMLVideoElement, canvas: HTMLCanvasElement): { url: string; scale: number; width: number; height: number } {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, 1280 / vw, 720 / vh);
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  let q = 0.7;
  let url = canvas.toDataURL("image/jpeg", q);
  while (url.length * 0.75 > 950_000 && q > 0.3) {
    q -= 0.15;
    url = canvas.toDataURL("image/jpeg", q);
  }
  return { url, scale, width: canvas.width, height: canvas.height };
}

/** Khung mặt (toạ độ video) → toạ độ pixel của snapshot, kẹp trong ảnh. Dùng cho lớp L2 phía server. */
export function boxToSnapshot(box: [number, number, number, number], snap: { scale: number; width: number; height: number }): [number, number, number, number] {
  const x = Math.max(0, Math.round(box[0] * snap.scale));
  const y = Math.max(0, Math.round(box[1] * snap.scale));
  const w = Math.max(1, Math.min(snap.width - x, Math.round(box[2] * snap.scale)));
  const h = Math.max(1, Math.min(snap.height - y, Math.round(box[3] * snap.scale)));
  return [x, y, w, h];
}

export async function openCamera(video: HTMLVideoElement, facingMode: "user" | "environment" = "user") {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? "Trình duyệt không hỗ trợ camera" : "Camera cần HTTPS (hoặc localhost)");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function beep(kind: "ok" | "warn" | "error") {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const notes = kind === "ok" ? [880, 1320] : kind === "warn" ? [660, 660] : [300, 220];
    notes.forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.14 + 0.13);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.14);
      o.stop(ac.currentTime + i * 0.14 + 0.14);
    });
    setTimeout(() => ac.close(), 800);
  } catch {
    /* không có âm thanh cũng không sao */
  }
}
