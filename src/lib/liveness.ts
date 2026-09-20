/**
 * Kết luận liveness phía SERVER (PRD mục 6 — chống giả mạo thụ động).
 * L1: điểm antispoof (`real`) và liveness (`live`) của Human trên kiosk, trung bình các khung, so với ngưỡng.
 * L2 (LIVENESS_SERVER=true): MiniFASNetV2 chạy lại trên vùng mặt cắt từ snapshot (src/lib/liveness-l2.ts).
 * Tọa độ Z / độ phẳng mesh KHÔNG được dùng để quyết định.
 *
 * Khi bật L2:
 *  - Thiếu snapshot hoặc khung mặt => TỪ CHỐI (client không được né L2 bằng cách bỏ trống dữ liệu).
 *  - Lỗi phía server (thiếu mô hình, lỗi runtime) => KHÔNG xác minh (`unavailable`, fail-closed); route quét trả 503 để kiosk
 *    giữ lần quét trong hàng đợi và gửi lại khi mô hình chạy; ADMIN được cảnh báo. Điểm L1 do kiosk tự báo không thay được L2.
 */
import { env } from "./env";
import { miniFasnetScore, type FaceBox } from "./liveness-l2";

export type FrameScore = { real: number; live: number };
export type ServerCheckResult = { score: number; ms?: number; probs?: number[] };
export type ServerLivenessCheck = (snapshot: Buffer, faceBox: FaceBox) => Promise<ServerCheckResult>;

export type L2Outcome =
  | { status: "disabled" }
  | { status: "missing_input" }
  | { status: "unavailable"; error: string }
  | { status: "checked"; score: number; threshold: number; pass: boolean; ms?: number; probs?: number[] };

const g = globalThis as unknown as { __l2Override?: ServerLivenessCheck | null; __l2Warned?: boolean };

/** Thay bộ kiểm tra L2 (dùng trong test hoặc để cắm mô hình khác). null = dùng MiniFASNetV2 mặc định. */
export function registerServerLiveness(fn: ServerLivenessCheck | null) {
  g.__l2Override = fn;
}

export function frameScore(f: FrameScore): number {
  // Cả hai mô-đun phải đồng thuận: lấy trung bình, nhưng một mô-đun quá thấp kéo điểm xuống.
  return Math.min((f.real + f.live) / 2, Math.min(f.real, f.live) + 0.25);
}

export function l1Score(frames: FrameScore[]): number {
  if (!frames.length) return 0;
  return frames.reduce((s, f) => s + frameScore(f), 0) / frames.length;
}

export async function evaluateLiveness(args: {
  frames: FrameScore[];
  threshold: number;
  serverThreshold: number;
  snapshot: Buffer | null;
  faceBox?: FaceBox | null;
}) {
  const l1 = l1Score(args.frames);
  const l1Pass = l1 >= args.threshold && args.frames.length >= 3;
  let server: L2Outcome = { status: "disabled" };

  if (env.livenessServer && l1Pass) {
    if (!args.snapshot || !args.faceBox) {
      server = { status: "missing_input" };
    } else {
      try {
        const check = g.__l2Override ?? ((s: Buffer, b: FaceBox) => miniFasnetScore(s, b).then((r) => ({ score: r.real, ms: r.ms, probs: r.probs })));
        const r = await check(args.snapshot, args.faceBox);
        server = { status: "checked", score: r.score, threshold: args.serverThreshold, pass: r.score >= args.serverThreshold, ms: r.ms, probs: r.probs };
      } catch (e) {
        const error = (e as Error).message;
        if (!g.__l2Warned) {
          g.__l2Warned = true;
          console.error("[liveness] L2 không chạy được — từ chối xác minh cho tới khi mô hình chạy lại:", error);
        }
        server = { status: "unavailable", error };
      }
    }
  }

  // L2 được bật mà không chạy được => KHÔNG xác minh (fail-closed): điểm L1 do kiosk tự báo không đủ làm bằng chứng người thật.
  // Route quét trả 503 để kiosk giữ lần quét trong hàng đợi và gửi lại khi mô hình hoạt động. L2 tắt (cấu hình) thì chỉ dùng L1.
  const verified = l1Pass && server.status !== "missing_input" && server.status !== "unavailable" && (server.status !== "checked" || server.pass);
  // Điểm lưu vào log = điểm yếu nhất giữa các lớp đã chạy.
  const score = server.status === "checked" ? Math.min(l1, server.score) : l1;
  return { score, l1, verified, server };
}
