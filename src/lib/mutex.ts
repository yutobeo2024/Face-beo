/**
 * Khóa theo khóa-chuỗi trong tiến trình (ứng dụng chạy 1 tiến trình theo PRD).
 * Dùng cho các thao tác "kiểm tra rồi ghi" cần tuần tự, ví dụ chống tạo 2 đơn trùng cùng lúc.
 */
const g = globalThis as unknown as { __locks?: Map<string, Promise<unknown>> };
const locks = (g.__locks ??= new Map());

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}
