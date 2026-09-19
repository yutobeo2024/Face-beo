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
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
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
  return data as T;
}

/** Hook tải dữ liệu đơn giản: tự tải lại khi URL đổi, tùy chọn làm mới theo chu kỳ. */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const my = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const d = await api<T>(url);
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
    void load();
  }, [load]);

  useEffect(() => {
    if (!opts.refreshMs || !url) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, url, load]);

  return { data, error, loading, reload: () => load(true), setData };
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}
