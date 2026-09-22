"use client";

/**
 * Ảnh đại diện tự chọn (v1.13.0): chọn file → cắt khung 3:4 (kéo để di chuyển, thanh trượt / con lăn / hai ngón tay để phóng to - thu nhỏ,
 * xoay 90°) → gửi phần đã cắt (JPEG 600×800) lên /api/employees/[id]/photo. Ảnh không dùng để nhận diện khuôn mặt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";

const OUT_W = 600;
const OUT_H = 800;
const VIEW_W = 240;
const VIEW_H = 320;
const MAX_ZOOM = 5;
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024; // khớp MAX_PHOTO_SOURCE_BYTES ở src/lib/profile-photo.ts
const MAX_SOURCE_PIXELS = 40_000_000; // chỉ để trình duyệt không treo khi mở ảnh; máy chủ chỉ nhận phần đã cắt 600×800
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

type View = { zoom: number; x: number; y: number; rot: number };

function geometry(img: HTMLImageElement, v: View) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const rw = v.rot % 180 ? ih : iw, rh = v.rot % 180 ? iw : ih;
  const s = Math.max(VIEW_W / rw, VIEW_H / rh) * v.zoom;
  const mx = Math.max(0, (rw * s - VIEW_W) / 2), my = Math.max(0, (rh * s - VIEW_H) / 2);
  return { s, mx, my };
}

/** Giữ ảnh luôn phủ kín khung (không lộ nền trống). */
function clamp(img: HTMLImageElement, v: View): View {
  const { mx, my } = geometry(img, v);
  return { ...v, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

/** Vẽ phần ảnh nằm trong khung lên canvas kích thước bất kỳ cùng tỉ lệ 3:4 (xem trước và xuất file dùng chung). */
function draw(canvas: HTMLCanvasElement, img: HTMLImageElement, v: View) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const k = canvas.width / VIEW_W;
  const { s } = geometry(img, v);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2 + v.x * k, canvas.height / 2 + v.y * k);
  ctx.rotate((v.rot * Math.PI) / 180);
  ctx.scale(s * k, s * k);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
}

function PhotoCropper({ img, busy, onCancel, onDone }: { img: HTMLImageElement; busy: boolean; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [v, setV] = useState<View>({ zoom: 1, x: 0, y: 0, rot: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const saving = useRef(false);
  const update = useCallback((f: (p: View) => View) => setV((p) => clamp(img, f(p))), [img]);

  useEffect(() => {
    if (canvas.current) draw(canvas.current, img, v);
  }, [img, v]);

  // Con lăn chuột: cần listener không passive để chặn cuộn trang.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      update((p) => ({ ...p, zoom: Math.min(MAX_ZOOM, Math.max(1, p.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function onDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: dist(), zoom: v.zoom };
  }
  function onMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const p = pinch.current;
      const d = dist();
      if (p.dist > 0) update((q) => ({ ...q, zoom: Math.min(MAX_ZOOM, Math.max(1, (p.zoom * d) / p.dist)) }));
    } else if (pointers.current.size === 1) {
      // Kéo theo kích thước hiển thị thật của khung (canvas có thể co trên màn hình nhỏ).
      const r = e.currentTarget.getBoundingClientRect();
      const f = VIEW_W / (r.width || VIEW_W);
      update((q) => ({ ...q, x: q.x + (e.clientX - prev.x) * f, y: q.y + (e.clientY - prev.y) * f }));
    }
  }
  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function finish() {
    if (saving.current || busy) return; // bấm "Lưu ảnh" hai lần nhanh: chỉ gửi một lần
    saving.current = true;
    const out = document.createElement("canvas");
    out.width = OUT_W;
    out.height = OUT_H;
    draw(out, img, v);
    out.toBlob((b) => {
      saving.current = false;
      if (b) onDone(b);
    }, "image/jpeg", 0.88);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvas}
        width={VIEW_W * 2}
        height={VIEW_H * 2}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="aspect-[3/4] w-60 max-w-full cursor-grab touch-none rounded-2xl ring-2 ring-brand-300 active:cursor-grabbing"
        aria-label="Kéo để di chuyển ảnh"
      />
      <p className="text-xs text-slate-500">Kéo để di chuyển · con lăn chuột hoặc hai ngón tay để phóng to / thu nhỏ</p>
      <div className="flex w-full max-w-xs items-center gap-2">
        <button type="button" className="size-8 rounded-lg text-lg font-bold text-slate-600 ring-1 ring-slate-300" onClick={() => update((p) => ({ ...p, zoom: Math.max(1, p.zoom / 1.2) }))} aria-label="Thu nhỏ">
          −
        </button>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={v.zoom}
          onChange={(e) => update((p) => ({ ...p, zoom: Number(e.target.value) }))}
          className="flex-1 accent-brand-700"
          aria-label="Mức phóng to"
        />
        <button type="button" className="size-8 rounded-lg text-lg font-bold text-slate-600 ring-1 ring-slate-300" onClick={() => update((p) => ({ ...p, zoom: Math.min(MAX_ZOOM, p.zoom * 1.2) }))} aria-label="Phóng to">
          +
        </button>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => update((p) => ({ ...p, rot: (p.rot + 90) % 360 }))}>
          Xoay 90°
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setV({ zoom: 1, x: 0, y: 0, rot: 0 })}>
          Đặt lại
        </Button>
      </div>
      <div className="flex w-full flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Hủy
        </Button>
        <Button onClick={finish} loading={busy}>
          Lưu ảnh
        </Button>
      </div>
    </div>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh"));
    };
    img.src = url;
  });
}

/**
 * Nút "Đổi ảnh" (+ "Xóa ảnh" khi đang có ảnh tự chọn) và cửa sổ cắt ảnh. `onChanged` gọi lại sau khi lưu / xóa để tải lại danh sách.
 */
export function PhotoEditor({ employeeId, name, hasPhoto, onChanged, compact }: { employeeId: number; name: string; hasPhoto: boolean; onChanged: () => void; compact?: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return toast.error("Chỉ nhận ảnh JPG, PNG hoặc WebP");
    if (file.size > MAX_SOURCE_BYTES) return toast.error(`Ảnh ${(file.size / 1024 / 1024).toFixed(1)} MB — tối đa 5 MB`);
    try {
      const im = await loadImage(file);
      if (im.naturalWidth * im.naturalHeight > MAX_SOURCE_PIXELS) return toast.error("Ảnh quá nhiều điểm ảnh (tối đa 40 triệu)");
      if (im.naturalWidth < 60 || im.naturalHeight < 60) return toast.error("Ảnh quá nhỏ");
      setImg(im);
    } catch {
      toast.error("Không đọc được ảnh");
    }
  }

  async function upload(blob: Blob) {
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/photo`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Không lưu được ảnh");
      toast.success("Đã đổi ảnh đại diện");
      setImg(null);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/photo`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Không xóa được ảnh");
      toast.success("Đã xóa ảnh tự chọn");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={ACCEPT.join(",")} className="hidden" onChange={pick} />
      <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
        <Button size="sm" variant="secondary" icon="edit" onClick={() => input.current?.click()} disabled={busy}>
          {hasPhoto ? "Đổi ảnh" : "Tải ảnh đại diện"}
        </Button>
        {hasPhoto && (
          <Button size="sm" variant="ghost" onClick={remove} loading={busy && !img}>
            Xóa ảnh
          </Button>
        )}
      </div>
      <Modal open={!!img} onClose={() => !busy && setImg(null)} title={`Ảnh đại diện — ${name}`}>
        {img && <PhotoCropper img={img} busy={busy} onCancel={() => setImg(null)} onDone={upload} />}
      </Modal>
    </>
  );
}
