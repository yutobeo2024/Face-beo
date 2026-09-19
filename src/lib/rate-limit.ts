/** Giới hạn tần suất cửa sổ trượt trong bộ nhớ (1 tiến trình, đủ cho self-host). */
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
const buckets = (g.__rl ??= new Map<string, number[]>());

export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

/** Đếm số lần trong cửa sổ mà không ghi thêm. */
export function rateCount(key: string, windowMs = 60_000): number {
  const now = Date.now();
  return (buckets.get(key) ?? []).filter((t) => now - t < windowMs).length;
}

export function resetRateLimits() {
  buckets.clear();
}
