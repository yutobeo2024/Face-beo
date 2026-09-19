"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { averageEmbedding, beep, boxToSnapshot, captureSnapshot, checkGate, engineInfo, loadEngine, meshFlatness, openCamera, stopCamera } from "@/lib/face/engine";
import { cooldownStep, startCooldown, type CooldownState } from "@/lib/face/cooldown";
import { DeviceRevokedError, NetworkError, queue, sendScan, type QueuedScan, type ScanResponse } from "@/lib/face/offline-queue";
import { Icon } from "@/components/icons";
import { cx, Spinner } from "@/components/ui";

type Phase = "boot" | "ready" | "collecting" | "sending" | "result" | "cooldown" | "fatal";
type Card = { tone: "ok" | "warn" | "error" | "info"; title: string; lines: string[] };

const FRAMES = 5;
const STABLE = 3;
const RESULT_MS = 3000;

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function toCard(r: ScanResponse): Card {
  switch (r.result) {
    case "OK": {
      const lines = [`${r.type === "IN" ? "Giờ vào" : "Giờ ra"} ${r.time}`];
      if (r.outOfShift) lines.push("Ngoài ca — quản lý sẽ xem xét");
      else if (r.type === "IN" && r.isLate) lines.push(`Trễ ${r.lateMinutes} phút`);
      else if (r.type === "OUT" && r.isEarly) lines.push(`Về sớm ${r.earlyMinutes} phút`);
      else lines.push(r.type === "IN" ? "Đúng giờ — chúc một ngày tốt lành!" : "Hẹn gặp lại!");
      return { tone: r.isLate || r.isEarly || r.outOfShift ? "warn" : "ok", title: r.employee?.name ?? "", lines };
    }
    case "DUPLICATE":
      return { tone: "info", title: r.employee?.name ?? "", lines: [r.message ?? `Bạn đã chấm lúc ${r.time}`] };
    case "REJECTED_SPOOF":
      return { tone: "error", title: "Không xác minh được", lines: [r.message ?? "Vui lòng nhìn thẳng vào camera"] };
    default:
      return { tone: "error", title: "Không nhận ra", lines: [r.message ?? "Vui lòng thử lại"] };
  }
}

export default function KioskPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const snapRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const phaseRef = useRef<Phase>("boot");
  const [hint, setHint] = useState("Đang khởi động…");
  const [card, setCard] = useState<Card | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [device, setDevice] = useState<{ name: string; location: string | null } | null>(null);
  const [backend, setBackend] = useState("");
  const [progress, setProgress] = useState(0);
  const now = useClock();
  const syncing = useRef(false);
  // Sau mỗi kết quả: chờ người vừa chấm rời đi (hoặc người khác bước vào) mới quét tiếp.
  const cooldownRef = useRef<CooldownState | null>(null);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const refreshCount = useCallback(async () => setPending(Number(await queue.count().catch(() => 0))), []);

  const onRevoked = useCallback(() => {
    go("fatal");
    setHint("Thiết bị chưa ghép hoặc đã bị thu hồi");
    setTimeout(() => router.replace("/kiosk/pair"), 3000);
  }, [router]);

  // Đồng bộ hàng đợi tuần tự khi có mạng.
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      for (const item of await queue.all()) {
        try {
          await sendScan(item);
          await queue.remove(item.clientEventId);
        } catch (e) {
          if (e instanceof DeviceRevokedError) return onRevoked();
          if (e instanceof NetworkError) break;
        }
      }
    } finally {
      syncing.current = false;
      void refreshCount();
    }
  }, [onRevoked, refreshCount]);

  // Ping thiết bị + trạng thái mạng.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/kiosk/ping", { cache: "no-store" });
        if (r.status === 401) return onRevoked();
        const d = await r.json();
        if (alive) {
          setOnline(true);
          setDevice(d.device);
        }
        void sync();
      } catch {
        if (alive) setOnline(false);
      }
    };
    void ping();
    void refreshCount();
    const t = setInterval(ping, 20_000);
    const on = () => void ping();
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [onRevoked, refreshCount, sync]);

  // Giữ màn hình sáng.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const get = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {}
    };
    void get();
    const vis = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      void lock?.release().catch(() => {});
    };
  }, []);

  const submit = useCallback(
    async (item: QueuedScan) => {
      go("sending");
      let r: ScanResponse | null = null;
      try {
        r = await sendScan(item);
        setOnline(true);
      } catch (e) {
        if (e instanceof DeviceRevokedError) return onRevoked();
        await queue.add(item).catch(() => {});
        void refreshCount();
        setOnline(false);
        setCard({ tone: "info", title: "Đã ghi nhận", lines: ["Mất kết nối — sẽ xác nhận khi có mạng"] });
        beep("warn");
      }
      if (r) {
        const c = toCard(r);
        setCard(c);
        beep(c.tone === "ok" || c.tone === "info" ? "ok" : c.tone === "warn" ? "warn" : "error");
      }
      go("result");
      const recognized = r?.result === "OK" || r?.result === "DUPLICATE";
      setTimeout(() => {
        setCard(null);
        setProgress(0);
        cooldownRef.current = startCooldown(recognized ? item.embedding : null, Date.now());
        setHint(recognized ? "Mời người tiếp theo" : "Vui lòng thử lại");
        go("cooldown");
      }, RESULT_MS);
    },
    [onRevoked, refreshCount],
  );

  // Vòng lặp nhận diện.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        const human = await loadEngine(setHint);
        setBackend(engineInfo(human).backend);
        stream = await openCamera(videoRef.current!);
        go("ready");
        setHint("Hãy nhìn vào camera");
        const video = videoRef.current!;
        let stable = 0;
        let frames: { real: number; live: number }[] = [];
        let embeds: number[][] = [];
        let flat: number | undefined;
        let size = 0;
        while (!stop) {
          const p = phaseRef.current;
          if (p !== "ready" && p !== "collecting" && p !== "cooldown") {
            await new Promise((r) => setTimeout(r, 120));
            continue;
          }
          const res = await human.detect(video);
          if (p === "cooldown") {
            // Chỉ theo dõi, không thu khung liveness và không gửi request.
            const faces = res.face.filter((x) => x.faceScore > 0.6 || x.score > 0.6);
            const step = cooldownStep(cooldownRef.current ?? startCooldown(null, 0), {
              faceCount: faces.length,
              embedding: faces.length === 1 ? (faces[0].embedding ?? null) : null,
              now: Date.now(),
            });
            cooldownRef.current = step.state;
            if (step.done) {
              cooldownRef.current = null;
              stable = 0;
              frames = [];
              embeds = [];
              setHint("Hãy nhìn vào camera");
              go("ready");
            }
            continue;
          }
          const g = checkGate(res.face, video, scratchRef.current!, { minFace: 180, maxAngle: 20 });
          if (!g.ok) {
            stable = 0;
            frames = [];
            embeds = [];
            setProgress(0);
            if (phaseRef.current === "collecting") go("ready");
            setHint(g.reason ?? "Hãy nhìn vào camera");
            continue;
          }
          if (phaseRef.current === "ready") {
            if (++stable < STABLE) {
              setHint("Giữ yên…");
              continue;
            }
            go("collecting");
          }
          const f = g.face!;
          frames.push({ real: f.real ?? 0, live: f.live ?? 0 });
          embeds.push(f.embedding!);
          flat = meshFlatness(f) ?? flat;
          size = Math.round(f.box[2]);
          setProgress(frames.length / FRAMES);
          setHint("Đang xác minh…");
          if (frames.length >= FRAMES) {
            const snap = captureSnapshot(video, snapRef.current!);
            const item: QueuedScan = {
              clientEventId: crypto.randomUUID(),
              capturedAt: new Date().toISOString(),
              embedding: averageEmbedding(embeds),
              frames,
              snapshot: snap.url,
              faceBox: boxToSnapshot(f.box, snap),
              meshFlatness: flat,
              faceSize: size,
            };
            stable = 0;
            frames = [];
            embeds = [];
            await submit(item);
          }
        }
      } catch (e) {
        go("fatal");
        setHint((e as Error).message || "Không khởi động được camera");
      }
    })();
    return () => {
      stop = true;
      stopCamera(stream);
    };
  }, [submit]);

  function fullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen?.bind(el);
    void req?.()
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
      .catch(() => {});
  }

  const toneCls = card?.tone === "ok" ? "from-emerald-500 to-emerald-700" : card?.tone === "warn" ? "from-amber-500 to-amber-700" : card?.tone === "error" ? "from-rose-500 to-rose-700" : "from-sky-500 to-sky-700";

  return (
    <main className="flex min-h-dvh flex-col landscape:flex-row">
      {/* Camera */}
      <section className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 size-full -scale-x-100 object-cover" playsInline muted />
        <canvas ref={snapRef} className="hidden" />
        <canvas ref={scratchRef} className="hidden" />
        {/* Khung hướng dẫn đặt mặt (chữ nhật bo góc + 4 góc đánh dấu) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cx(
              "relative aspect-[4/5] h-[62%] rounded-3xl border-2 transition-colors duration-300",
              phase === "collecting" || phase === "sending"
                ? "border-emerald-400/70 shadow-[0_0_0_9999px_rgb(2_6_23/0.45)]"
                : "border-white/25 shadow-[0_0_0_9999px_rgb(2_6_23/0.55)]",
            )}
          >
            {(["top-0 left-0 border-t-[6px] border-l-[6px] rounded-tl-3xl", "top-0 right-0 border-t-[6px] border-r-[6px] rounded-tr-3xl", "bottom-0 left-0 border-b-[6px] border-l-[6px] rounded-bl-3xl", "bottom-0 right-0 border-b-[6px] border-r-[6px] rounded-br-3xl"] as const).map((pos) => (
              <span
                key={pos}
                className={cx(
                  "absolute -m-[3px] size-14 transition-colors duration-300",
                  pos,
                  phase === "collecting" || phase === "sending" ? "border-emerald-400" : phase === "cooldown" ? "border-sky-300" : "border-white",
                )}
              />
            ))}
          </div>
        </div>
        {(phase === "collecting" || phase === "sending") && (
          <div className="absolute inset-x-0 bottom-24 mx-auto h-2 w-56 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${phase === "sending" ? 100 : progress * 100}%` }} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pt-12 pb-6 text-center">
          <p className="flex items-center justify-center gap-2 text-2xl font-bold drop-shadow sm:text-3xl">
            {(phase === "boot" || phase === "sending") && <Spinner className="size-6" />}
            {phase === "sending" ? "Đang xử lý…" : hint}
          </p>
        </div>
        {/* Thẻ kết quả */}
        {card && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 p-6 backdrop-blur-sm">
            <div className={cx("w-full max-w-md animate-pop rounded-3xl bg-gradient-to-br p-7 text-center shadow-2xl", toneCls)}>
              <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-white/20">
                <Icon name={card.tone === "error" ? "x" : card.tone === "warn" ? "alert" : "check"} className="size-9" strokeWidth={2.6} />
              </div>
              <p className="text-3xl font-bold">{card.title}</p>
              {card.lines.map((l) => (
                <p key={l} className="mt-1 text-xl text-white/90">
                  {l}
                </p>
              ))}
            </div>
          </div>
        )}
        {phase === "fatal" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950/90 p-6 text-center">
            <Icon name="alert" className="size-12 text-rose-400" />
            <p className="max-w-md text-xl font-semibold">{hint}</p>
            <button onClick={() => location.reload()} className="rounded-xl bg-white/10 px-5 py-3 font-semibold hover:bg-white/20">
              Thử lại
            </button>
          </div>
        )}
      </section>

      {/* Bảng thông tin */}
      <aside className="flex shrink-0 flex-row items-center justify-between gap-4 bg-slate-900 px-5 py-4 landscape:w-72 landscape:flex-col landscape:items-stretch landscape:justify-start landscape:py-8 xl:landscape:w-80">
        <div>
          <p className="text-5xl font-bold tabular-nums landscape:text-6xl">
            {now ? now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "--:--"}
          </p>
          <p className="mt-1 text-slate-400">{now ? now.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }) : ""}</p>
        </div>
        <div className="flex flex-col gap-2 text-sm landscape:mt-8">
          <span className={cx("inline-flex items-center gap-2 font-semibold", online ? "text-emerald-400" : "text-amber-400")}>
            <Icon name={online ? "wifi" : "wifiOff"} className="size-5" /> {online ? "Trực tuyến" : "Mất kết nối"}
          </span>
          <span className={cx("inline-flex items-center gap-2", pending ? "font-semibold text-amber-300" : "text-slate-400")}>
            <Icon name="refresh" className="size-5" /> {pending} bản ghi chờ đồng bộ
          </span>
        </div>
        <div className="hidden text-sm text-slate-400 landscape:mt-auto landscape:block">
          <p className="font-semibold text-slate-200">{device?.name ?? "Kiosk"}</p>
          {device?.location && <p>{device.location}</p>}
          {backend && <p className="mt-1 text-xs text-slate-500">Engine: {backend}</p>}
          <button onClick={fullscreen} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-slate-300 hover:bg-white/10">
            <Icon name="maximize" className="size-4" /> Toàn màn hình
          </button>
        </div>
      </aside>
    </main>
  );
}
