"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Icon } from "@/components/icons";
import { Spinner } from "@/components/ui";

export default function PairPage() {
  const router = useRouter();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  async function submit(code: string) {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/kiosk/pair", { body: { code } });
      router.replace("/kiosk");
    } catch (e) {
      setErr((e as Error).message);
      setDigits(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function set(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    const next = [...digits];
    if (clean.length > 1) {
      clean.slice(0, 6 - i).split("").forEach((c, k) => (next[i + k] = c));
    } else next[i] = clean;
    setDigits(next);
    const firstEmpty = next.findIndex((d) => !d);
    if (firstEmpty === -1) void submit(next.join(""));
    else if (clean) refs.current[Math.min(5, i + clean.length)]?.focus();
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-6 rounded-3xl bg-brand-500/15 p-4 text-brand-300">
        <Icon name="tablet" className="size-10" />
      </div>
      <h1 className="text-3xl font-bold">Ghép thiết bị kiosk</h1>
      <p className="mt-2 max-w-md text-slate-400">Nhập mã 6 số do quản trị tạo tại trang “Thiết bị kiosk”. Mã có hiệu lực 10 phút.</p>
      <div className="mt-8 flex gap-2 sm:gap-3" onPaste={(e) => (e.preventDefault(), set(0, e.clipboardData.getData("text")))}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={d}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus={i === 0}
            disabled={busy}
            aria-label={`Chữ số ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            }}
            className="h-16 w-12 rounded-2xl border-2 border-slate-700 bg-slate-900 text-center font-mono text-3xl font-bold text-white focus:border-brand-400 focus:outline-none sm:h-20 sm:w-16"
          />
        ))}
      </div>
      <div className="mt-6 h-6">
        {busy && (
          <span className="inline-flex items-center gap-2 text-slate-300">
            <Spinner className="size-4" /> Đang ghép…
          </span>
        )}
        {err && <span className="font-medium text-rose-400">{err}</span>}
      </div>
    </main>
  );
}
