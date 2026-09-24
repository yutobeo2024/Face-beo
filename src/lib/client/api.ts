"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const res = await fetch(url, {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth") && !url.startsWith("/api/kiosk")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) throw new ApiError(String(data.error ?? `Lỗi ${res.status}`), res.status, data);
  // Ghi dữ liệu là dữ liệu cũ hết giá trị: dọn kho nhớ để màn hình khác không hiện số liệu cũ.
  if (method !== "GET") clearApiCache();
  return data as T;
}

// --------------------------------------------------------------------------------------------------------------
// Kho nhớ dùng chung cho useApi (v1.16.0). Máy chủ ở xa (mỗi lượt gọi ~0,3 giây trên 4G) nên đổi tab / bấm Back mà
// tải lại từ đầu là thấy trắng màn hình. Cách làm: hiện NGAY dữ liệu lần trước rồi lặng lẽ tải lại nền;
// nhiều component hỏi cùng một URL thì chỉ gọi mạng một lần.
type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
/** Đổi mỗi lần ghi dữ liệu: lượt GET bắt đầu TRƯỚC đó xong muộn cũng không được ghi vào kho (nếu không sẽ ghim dữ liệu cũ). */
let gen = 0;
/** Dữ liệu mới hơn mốc này thì khỏi tải lại khi vừa mở lại màn hình (đổi tab qua lại rất nhanh). */
const FRESH_MS = 5_000;

export function clearApiCache() {
  gen++;
  cache.clear();
  inflight.clear();
}

/** GET có gộp lời gọi trùng URL: hai component cùng hỏi một địa chỉ chỉ tốn một lượt mạng. */
function fetchShared<T>(url: string): Promise<T> {
  const cur = inflight.get(url);
  if (cur) return cur as Promise<T>;
  const myGen = gen;
  const promise = api<T>(url)
    .then((d) => {
      if (myGen === gen) cache.set(url, { data: d, at: Date.now() });
      return d;
    })
    .finally(() => {
      if (inflight.get(url) === promise) inflight.delete(url);
    });
  inflight.set(url, promise);
  return promise;
}

/**
 * Hook tải dữ liệu: hiện ngay dữ liệu đã có trong kho nhớ, tải lại nền cho mới; đổi URL thì tự tải lại;
 * tùy chọn làm mới theo chu kỳ (chỉ khi màn hình đang hiện).
 */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const cached = url ? (cache.get(url) as Entry | undefined) : undefined;
  const [data, setData] = useState<T | null>((cached?.data as T) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url && !cached);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const my = ++seq.current;
      if (!silent && !cache.has(url)) setLoading(true);
      try {
        const d = await fetchShared<T>(url);
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (my === seq.current) setError((e as Error).message);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit) {
      setData(hit.data as T);
      setLoading(false);
      if (Date.now() - hit.at < FRESH_MS) return; // vừa lấy xong, khỏi hỏi lại
      void load(true); // hiện dữ liệu cũ, làm mới ngầm
      return;
    }
    void load();
  }, [url, load]);

  useEffect(() => {
    if (!opts.refreshMs || !url) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, url, load]);

  const reload = useCallback(() => {
    if (url) {
      cache.delete(url);
      inflight.delete(url); // không dùng lại lượt bắt đầu trước khi ghi dữ liệu
    }
    return load(true);
  }, [url, load]);

  return { data, error, loading, reload, setData };
}

/** Giá trị chậm nhịp: ô tìm kiếm gõ 6 chữ chỉ gọi máy chủ một lần thay vì sáu lần. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}
