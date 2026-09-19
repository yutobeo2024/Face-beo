/**
 * So khớp 1:N trên server (PRD mục 6). Template được giải mã vào bộ nhớ, làm mới khi enroll/xóa.
 * 100 người × 5 mẫu = 500 vector, so khớp tuyến tính cosine.
 */
import { prisma } from "./db";
import { decryptDescriptor } from "./crypto";
import { FACE_MODEL_VERSION } from "./roles";

type Entry = { employeeId: number; vec: Float32Array };
const g = globalThis as unknown as {
  __faceCache?: { entries: Entry[]; loadedAt: number } | null;
  __faceLoading?: Promise<Entry[]> | null;
  __faceGen?: number;
};

export function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

async function load(): Promise<Entry[]> {
  const gen = g.__faceGen ?? 0;
  const rows = await prisma.faceTemplate.findMany({
    where: { modelVersion: FACE_MODEL_VERSION, employee: { active: true } },
    select: { employeeId: true, descriptor: true },
  });
  const entries: Entry[] = [];
  for (const r of rows) {
    try {
      entries.push({ employeeId: r.employeeId, vec: normalize(decryptDescriptor(r.descriptor)) });
    } catch {
      console.error("[face] không giải mã được template của nhân viên", r.employeeId);
    }
  }
  // Chỉ lưu cache nếu không có enroll/xóa nào xảy ra trong lúc đang nạp (tránh giữ template đã xóa).
  if ((g.__faceGen ?? 0) === gen) g.__faceCache = { entries, loadedAt: Date.now() };
  return entries;
}

export async function getTemplates(): Promise<Entry[]> {
  if (g.__faceCache) return g.__faceCache.entries;
  if (!g.__faceLoading) {
    const p = load().finally(() => {
      if (g.__faceLoading === p) g.__faceLoading = null;
    });
    g.__faceLoading = p;
  }
  return g.__faceLoading;
}

export function invalidateFaceCache() {
  g.__faceGen = (g.__faceGen ?? 0) + 1;
  g.__faceCache = null;
  g.__faceLoading = null;
}

export type MatchResult = {
  employeeId: number | null;
  top1: number;
  top2: number;
  top1EmployeeId: number | null;
};

/** Điểm cao nhất theo từng nhân viên; chấp nhận khi top1 ≥ threshold và top1 − top2 ≥ margin. */
export function matchAgainst(entries: Entry[], embedding: ArrayLike<number>, threshold: number, margin: number, excludeEmployeeId?: number): MatchResult {
  const q = normalize(embedding);
  const best = new Map<number, number>();
  for (const e of entries) {
    if (e.employeeId === excludeEmployeeId) continue;
    const s = cosine(q, e.vec);
    if (s > (best.get(e.employeeId) ?? -2)) best.set(e.employeeId, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  const top1 = first?.[1] ?? 0;
  const top2 = second?.[1] ?? 0;
  const ok = first != null && top1 >= threshold && top1 - top2 >= margin;
  return { employeeId: ok ? first[0] : null, top1, top2, top1EmployeeId: first?.[0] ?? null };
}

export async function matchFace(embedding: ArrayLike<number>, threshold: number, margin: number): Promise<MatchResult> {
  return matchAgainst(await getTemplates(), embedding, threshold, margin);
}
