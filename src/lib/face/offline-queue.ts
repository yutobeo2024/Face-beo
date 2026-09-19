"use client";
/**
 * Hàng đợi offline của kiosk (IndexedDB). Chỉ chứa snapshot + 5 điểm mốc + điểm liveness + capturedAt,
 * KHÔNG chứa template hay danh sách nhân viên. Bản ghi bị xóa ngay khi đồng bộ thành công.
 */
export type QueuedScan = {
  clientEventId: string;
  capturedAt: string;
  /** 5 điểm mốc theo pixel của snapshot (mắt trái, mắt phải, mũi, khóe miệng trái, phải). */
  landmarks: [number, number][];
  frames: { real: number; live: number }[];
  snapshot: string;
  meshFlatness?: number;
  faceSize?: number;
  faceBox?: [number, number, number, number];
  attempts?: number;
};

const DB = "facebeo-kiosk";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "clientEventId" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export const queue = {
  add: (s: QueuedScan) => tx("readwrite", (st) => st.put(s)),
  remove: (id: string) => tx("readwrite", (st) => st.delete(id)),
  all: async () => ((await tx("readonly", (st) => st.getAll())) as QueuedScan[]).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
  count: () => tx("readonly", (st) => st.count()),
};

export type ScanResponse = {
  result: "OK" | "DUPLICATE" | "NO_MATCH" | "REJECTED_SPOOF";
  message?: string;
  employee?: { name: string; code: string };
  type?: "IN" | "OUT";
  time?: string;
  isLate?: boolean;
  lateMinutes?: number;
  isEarly?: boolean;
  earlyMinutes?: number;
  outOfShift?: boolean;
  duplicateEvent?: boolean;
};

export class NetworkError extends Error {}
export class DeviceRevokedError extends Error {}

/** Gửi 1 lần quét. Lỗi mạng / 5xx / 429 => NetworkError (giữ trong hàng đợi). 401 => thiết bị bị thu hồi. */
export async function sendScan(s: QueuedScan, timeoutMs = 8000): Promise<ScanResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("/api/kiosk/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        landmarks: s.landmarks,
        frames: s.frames,
        snapshot: s.snapshot,
        clientEventId: s.clientEventId,
        capturedAt: s.capturedAt,
        meshFlatness: s.meshFlatness,
        faceSize: s.faceSize,
        faceBox: s.faceBox,
      }),
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError("Mất kết nối");
  } finally {
    clearTimeout(t);
  }
  if (res.status === 401) throw new DeviceRevokedError("Thiết bị chưa ghép hoặc đã bị thu hồi");
  if (res.status >= 500 || res.status === 429) throw new NetworkError(`Máy chủ bận (${res.status})`);
  const data = (await res.json().catch(() => ({}))) as ScanResponse & { error?: string };
  if (!res.ok) return { result: "NO_MATCH", message: data.error ?? `Lỗi ${res.status}` };
  return data;
}
