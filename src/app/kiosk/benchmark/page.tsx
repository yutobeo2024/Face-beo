"use client";
import { useEffect, useRef, useState } from "react";
import { captureSnapshot, checkGate, engineInfo, loadEngine, openCamera, stopCamera } from "@/lib/face/engine";
import { Spinner } from "@/components/ui";

const RUNS = 50;

function pct(arr: number[], p: number) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/**
 * Đo 50 lượt: từ lúc mặt ổn định => 5 khung liveness + embedding + snapshot JPEG + 1 vòng mạng tới server (ping).
 * So khớp 1:N trên server < 5 ms nên không ảnh hưởng đáng kể. Mục tiêu p95 ≤ 1500 ms.
 */
export default function BenchmarkPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const snapRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Đang tải mô hình…");
  const [times, setTimes] = useState<number[]>([]);
  const [info, setInfo] = useState<{ backend: string; version: string; warmup: number } | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      const t0 = performance.now();
      const human = await loadEngine(setStatus);
      setInfo({ ...engineInfo(human), warmup: Math.round(performance.now() - t0) });
      stream = await openCamera(videoRef.current!);
      setStatus("Sẵn sàng — đứng trước camera rồi bấm Bắt đầu");
    })().catch((e) => setStatus((e as Error).message));
    return () => stopCamera(stream);
  }, []);

  async function run() {
    if (started.current) return;
    started.current = true;
    setRunning(true);
    setTimes([]);
    const human = await loadEngine();
    const video = videoRef.current!;
    const out: number[] = [];
    while (out.length < RUNS) {
      // Chờ mặt đạt cổng chất lượng
      const g0 = checkGate((await human.detect(video)).face, video, scratchRef.current!, { minFace: 180, maxAngle: 20 });
      if (!g0.ok) {
        setStatus(`Lượt ${out.length + 1}/${RUNS}: ${g0.reason}`);
        continue;
      }
      const t = performance.now();
      let n = 0;
      while (n < 5) {
        const g = checkGate((await human.detect(video)).face, video, scratchRef.current!, { minFace: 180, maxAngle: 20 });
        if (g.ok) n++;
      }
      captureSnapshot(video, snapRef.current!);
      await fetch("/api/kiosk/ping", { cache: "no-store" });
      out.push(performance.now() - t);
      setTimes([...out]);
      setStatus(`Lượt ${out.length}/${RUNS}`);
    }
    setStatus("Hoàn tất");
    setRunning(false);
    started.current = false;
  }

  const p50 = times.length ? pct(times, 50) : 0;
  const p95 = times.length ? pct(times, 95) : 0;

  return (
    <main className="grid min-h-dvh gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="size-full -scale-x-100 object-cover" playsInline muted />
        <canvas ref={snapRef} className="hidden" />
        <canvas ref={scratchRef} className="hidden" />
      </div>
      <section className="flex flex-col gap-4 rounded-2xl bg-slate-900 p-5">
        <h1 className="text-2xl font-bold">Benchmark kiosk</h1>
        <p className="text-sm text-slate-400">{status}</p>
        {info && (
          <p className="text-sm text-slate-400">
            Backend <b className="text-white">{info.backend}</b> · Human {info.version} · nạp + warm-up {info.warmup} ms
          </p>
        )}
        <button onClick={run} disabled={running || !info} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold hover:bg-brand-500 disabled:opacity-50">
          {running && <Spinner className="size-5" />} {running ? `Đang chạy ${times.length}/${RUNS}` : `Bắt đầu ${RUNS} lượt`}
        </button>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ["p50", p50],
            ["p95", p95],
            ["max", times.length ? Math.max(...times) : 0],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-white/5 p-3">
              <dt className="text-xs text-slate-400 uppercase">{k}</dt>
              <dd className={`text-2xl font-bold tabular-nums ${k === "p95" && times.length >= RUNS ? ((v as number) <= 1500 ? "text-emerald-400" : "text-rose-400") : ""}`}>{Math.round(v as number)} ms</dd>
            </div>
          ))}
        </dl>
        {times.length >= RUNS && <p className={`text-center font-semibold ${p95 <= 1500 ? "text-emerald-400" : "text-rose-400"}`}>{p95 <= 1500 ? "ĐẠT mục tiêu p95 ≤ 1,5 giây" : "CHƯA ĐẠT mục tiêu p95 ≤ 1,5 giây"}</p>}
        <div className="flex h-24 items-end gap-px">
          {times.map((t, i) => (
            <div key={i} className={`flex-1 rounded-t ${t <= 1500 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ height: `${Math.min(100, (t / 2500) * 100)}%` }} />
          ))}
        </div>
      </section>
    </main>
  );
}
