"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { beep, boxToSnapshot, captureSnapshot, checkGate, engineInfo, landmarks5, landmarksToSnapshot, loadEngine, meshFlatness, openCamera, stopCamera } from "@/lib/face/engine";
import { cooldownStep, startCooldown, type CooldownState } from "@/lib/face/cooldown";
import { isIdle, phaseAfterResult } from "@/lib/face/standby";
import { boxToRect, coverFit, rectToScreen } from "@/lib/face/overlay";
import { chestRectRaw } from "@/lib/uniform-crop";
import { DeviceRevokedError, NetworkError, queue, sendScan, type QueuedScan, type ScanResponse } from "@/lib/face/offline-queue";
import { Icon } from "@/components/icons";
import { cx, Spinner } from "@/components/ui";

// "standby" (v1.21.0): camera TẮT, chờ người chạm màn hình — đi ngang lúc này không thể bị ghi lượt quét.
type Phase = "boot" | "standby" | "ready" | "collecting" | "sending" | "result" | "cooldown" | "fatal";
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
  /** Khung mặt (tọa độ video) của lượt quét vừa gửi — dùng cho hồi chiêu. */
  const lastVideoBoxRef = useRef<[number, number, number, number] | null>(null);
  // Lớp phủ "máy đang nhìn vào đâu" (v1.20.2): ghi thẳng style, KHÔNG qua state React — vòng nhận diện chạy liên tục,
  // setState mỗi khung hình sẽ làm rớt khung.
  const frameRef = useRef<HTMLDivElement>(null);
  const staticGuideRef = useRef<HTMLDivElement>(null);
  const liveGuideRef = useRef<HTMLDivElement>(null);
  const faceBoxRef = useRef<HTMLDivElement>(null);
  const shirtBoxRef = useRef<HTMLDivElement>(null);
  // Chế độ chờ (v1.21.0): giữ luồng camera để bật / tắt được, và mốc lần cuối thấy khuôn mặt để tự ngủ.
  const streamRef = useRef<MediaStream | null>(null);
  const lastSeenRef = useRef<number | null>(null);
  const wakingRef = useRef(false);
  const kioskCfgRef = useRef({ idleSeconds: 120, awakeSeconds: 0 });
  /** Hàm tắt camera về màn hình chờ — đặt trong vòng lặp, gọi được từ chỗ khác (sau mỗi kết quả). */
  const sleepRef = useRef<(() => void) | null>(null);

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
          if (e instanceof NetworkError) {
            // Mất mạng hẳn: dừng, chờ ping tiếp theo. Server trả 5xx/429 cho riêng bản ghi này: đếm số lần, quá 30 lần thì bỏ để
            // không chặn các bản ghi phía sau (bản ghi quá 24 giờ server cũng không nhận nữa).
            if (e.status == null) break;
            // 503 = máy chủ chưa sẵn sàng (thiếu mô hình nhận diện / xác minh người thật) — sự cố chung, có thể kéo dài hàng giờ:
            // dừng cả vòng, KHÔNG đếm lần thử, giữ nguyên hàng đợi cho tới khi máy chủ chạy lại (giờ quét vẫn là giờ thật).
            if (e.status === 503) break;
            const attempts = (item.attempts ?? 0) + 1;
            if (attempts >= 30) await queue.remove(item.clientEventId);
            else await queue.add({ ...item, attempts }).catch(() => {});
          }
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
    let apiVersion: string | null = null;
    const ping = async () => {
      try {
        const r = await fetch("/api/kiosk/ping", { cache: "no-store" });
        if (r.status === 401) return onRevoked();
        const v = (await r.clone().json().catch(() => null)) as { apiVersion?: string } | null;
        if (v?.apiVersion) {
          if (apiVersion && apiVersion !== v.apiVersion) return location.reload();
          apiVersion = v.apiVersion;
        }
        const d = await r.json();
        if (alive) {
          setOnline(true);
          setDevice(d.device);
          if (d.kiosk) kioskCfgRef.current = { idleSeconds: Number(d.kiosk.idleSeconds) || 120, awakeSeconds: Number(d.kiosk.awakeSeconds) || 0 };
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
        const serverSide = e instanceof NetworkError && e.status != null;
        setCard({ tone: serverSide ? "warn" : "info", title: serverSide ? "Chưa xác nhận được" : "Đã ghi nhận", lines: [serverSide ? `${(e as Error).message} — đã lưu, sẽ gửi lại` : "Mất kết nối — sẽ xác nhận khi có mạng"] });
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
        // Mặc định về chờ ngay (camera tắt, người sau phải chạm). Đặt kioskAwakeSeconds > 0 thì giữ thức cho hàng đợi.
        if (phaseAfterResult(kioskCfgRef.current.awakeSeconds) === "standby") {
          sleepRef.current?.();
          return;
        }
        cooldownRef.current = startCooldown(recognized ? lastVideoBoxRef.current : null, Date.now());
        lastSeenRef.current = Date.now();
        setHint(recognized ? "Mời người tiếp theo" : "Vui lòng thử lại");
        go("cooldown");
      }, RESULT_MS);
    },
    [onRevoked, refreshCount],
  );

  /**
   * Vẽ ô khuôn mặt và dải vùng áo lên đúng vị trí người đang đứng.
   * `box` null = chưa thấy mặt → ẩn lớp phủ, hiện khung tĩnh.
   */
  const paintGuide = useCallback((video: HTMLVideoElement, box: [number, number, number, number] | null, ok: boolean) => {
    const live = liveGuideRef.current;
    const still = staticGuideRef.current;
    if (!live || !still) return;
    // Viền khung ngoài đổi màu NGAY khi đạt cổng, không đợi sang giai đoạn thu khung.
    if (frameRef.current) frameRef.current.style.borderColor = box && ok ? "rgb(52 211 153 / 0.7)" : "rgb(255 255 255 / 0.25)";
    if (!box) {
      live.style.opacity = "0";
      still.style.opacity = "1";
      return;
    }
    const el = video.getBoundingClientRect();
    const fit = coverFit(video.videoWidth, video.videoHeight, el.width, el.height);
    const put = (node: HTMLDivElement | null, r: { left: number; top: number; width: number; height: number }) => {
      if (!node) return;
      const s = rectToScreen(r, fit, el.width, true);
      node.style.left = `${s.left}px`;
      node.style.top = `${s.top}px`;
      node.style.width = `${s.width}px`;
      node.style.height = `${s.height}px`;
    };
    put(faceBoxRef.current, boxToRect(box));
    // Vùng áo vẽ bản CHƯA kẹp vào khung hình: đứng quá sát thì dải tụt hẳn ra ngoài đáy — thấy ngay vì sao phải lùi.
    put(shirtBoxRef.current, chestRectRaw(box));
    const tone = ok ? "rgb(52 211 153)" : "rgb(251 191 36)"; // xanh lục khi đạt · vàng khi chưa
    if (faceBoxRef.current) faceBoxRef.current.style.borderColor = tone;
    if (shirtBoxRef.current) {
      shirtBoxRef.current.style.borderColor = tone;
      shirtBoxRef.current.style.backgroundColor = ok ? "rgb(52 211 153 / 0.18)" : "rgb(251 191 36 / 0.18)";
    }
    live.style.opacity = "1";
    still.style.opacity = "0";
  }, []);

  // Vòng lặp nhận diện. Mô hình nạp ngay khi mở trang, nhưng CAMERA CHỈ BẬT KHI CÓ NGƯỜI CHẠM (v1.21.0).
  useEffect(() => {
    let stop = false;
    /** Tắt camera, dọn trạng thái dở dang, về màn hình chờ. */
    const sleep = () => {
      stopCamera(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
      lastSeenRef.current = null;
      cooldownRef.current = null;
      if (liveGuideRef.current) liveGuideRef.current.style.opacity = "0";
      if (staticGuideRef.current) staticGuideRef.current.style.opacity = "1";
      setCard(null);
      setProgress(0);
      setHint("Chạm để chấm công");
      go("standby");
    };
    sleepRef.current = sleep;
    (async () => {
      try {
        const human = await loadEngine(setHint);
        setBackend(engineInfo(human).backend);
        go("standby");
        setHint("Chạm để chấm công");
        let stable = 0;
        let frames: { real: number; live: number }[] = [];
        let flat: number | undefined;
        let size = 0;
        while (!stop) {
          const p = phaseRef.current;
          // "standby" nằm ngoài danh sách này nên lúc chờ vòng lặp chỉ nghỉ, KHÔNG gọi human.detect.
          if (p !== "ready" && p !== "collecting" && p !== "cooldown") {
            await new Promise((r) => setTimeout(r, 120));
            continue;
          }
          const video = videoRef.current;
          if (!video || !streamRef.current) {
            await new Promise((r) => setTimeout(r, 120));
            continue;
          }
          const res = await human.detect(video);
          if (res.face.some((x) => x.faceScore > 0.6 || x.score > 0.6)) lastSeenRef.current = Date.now();
          else if (isIdle(Date.now(), lastSeenRef.current, kioskCfgRef.current.idleSeconds)) {
            sleep(); // vắng quá lâu: tắt camera, khỏi chạy suốt
            continue;
          }
          if (p === "cooldown") {
            // Chỉ theo dõi, không thu khung liveness và không gửi request.
            const faces = res.face.filter((x) => x.faceScore > 0.6 || x.score > 0.6);
            const step = cooldownStep(cooldownRef.current ?? startCooldown(null, 0), {
              faceCount: faces.length,
              box: faces.length === 1 ? (faces[0].box as [number, number, number, number]) : null,
              now: Date.now(),
            });
            paintGuide(video, null, false); // đang chờ người tiếp theo: không vẽ bám ai
            cooldownRef.current = step.state;
            if (step.done) {
              cooldownRef.current = null;
              stable = 0;
              frames = [];
              setHint("Hãy nhìn vào camera");
              go("ready");
            }
            continue;
          }
          // chestRoom 1.1: dưới cằm còn ≥ 1,1 lần chiều cao mặt → ảnh lấy trọn vùng ngực, nơi có logo áo đồng phục (v1.20.0).
          const g = checkGate(res.face, video, scratchRef.current!, { minFace: 180, maxAngle: 20, chestRoom: 1.1 });
          paintGuide(video, g.face ? (g.face.box as [number, number, number, number]) : null, g.ok);
          if (!g.ok) {
            stable = 0;
            frames = [];
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
          flat = meshFlatness(f) ?? flat;
          size = Math.round(f.box[2]);
          setProgress(frames.length / FRAMES);
          setHint("Đang xác minh…");
          if (frames.length >= FRAMES) {
            const pts = landmarks5(f);
            if (!pts) {
              frames = [];
              continue;
            }
            const snap = captureSnapshot(video, snapRef.current!);
            lastVideoBoxRef.current = [f.box[0], f.box[1], f.box[2], f.box[3]];
            const item: QueuedScan = {
              clientEventId: crypto.randomUUID(),
              capturedAt: new Date().toISOString(),
              landmarks: landmarksToSnapshot(pts, snap),
              frames,
              snapshot: snap.url,
              faceBox: boxToSnapshot(f.box, snap),
              meshFlatness: flat,
              faceSize: size,
            };
            stable = 0;
            frames = [];
            await submit(item);
          }
        }
      } catch (e) {
        go("fatal");
        setHint((e as Error).message || "Không khởi động được mô hình nhận diện");
      }
    })();
    return () => {
      stop = true;
      sleepRef.current = null;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [submit, paintGuide]);

  /** Chạm màn hình chờ: bật camera rồi vào trạng thái sẵn sàng. Mở camera lỗi thì Ở LẠI màn hình chờ để chạm lại. */
  async function wake() {
    if (wakingRef.current || phaseRef.current !== "standby") return;
    wakingRef.current = true;
    setHint("Đang bật camera…");
    try {
      streamRef.current = await openCamera(videoRef.current!);
      lastSeenRef.current = Date.now();
      setHint("Hãy nhìn vào camera");
      go("ready");
    } catch (e) {
      setHint((e as Error).message || "Không mở được camera — chạm để thử lại");
    } finally {
      wakingRef.current = false;
    }
  }

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
        {/*
          Lớp phủ "máy đang nhìn vào đâu" (v1.20.2): ô bám theo khuôn mặt và dải tô sáng ĐÚNG vùng áo mà máy chủ
          sẽ cắt (cùng hằng số SHIRT_CROP). Vị trí do paintGuide ghi thẳng vào style mỗi khung hình.
        */}
        <div ref={liveGuideRef} className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200">
          <div ref={faceBoxRef} className="absolute rounded-2xl border-[3px] transition-colors duration-200" style={{ borderColor: "rgb(251 191 36)" }} />
          <div ref={shirtBoxRef} className="absolute rounded-xl border-2 border-dashed transition-colors duration-200" style={{ borderColor: "rgb(251 191 36)" }}>
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-semibold tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              vùng áo
            </span>
          </div>
        </div>
        {/* Khung hướng dẫn đặt mặt (chữ nhật bo góc + 4 góc đánh dấu) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            ref={frameRef}
            className={cx(
              // Tỉ lệ ảnh thẻ 4×6 (2:3): đứng đúng khung thì ảnh có cả mặt lẫn phần áo (v1.20.0).
              "relative aspect-[2/3] h-[76%] rounded-3xl border-2 transition-colors duration-300",
              phase === "collecting" || phase === "sending"
                ? "shadow-[0_0_0_9999px_rgb(2_6_23/0.45)]"
                : "shadow-[0_0_0_9999px_rgb(2_6_23/0.55)]",
            )}
            style={{ borderColor: "rgb(255 255 255 / 0.25)" }}
          >
            {/* Khung tĩnh: chỉ hiện khi CHƯA thấy mặt; thấy mặt rồi thì lớp phủ bên trên vẽ bám theo người. */}
            <div ref={staticGuideRef} className="absolute inset-0 transition-opacity duration-200">
              <span className="absolute inset-x-[22%] top-[10%] h-[42%] rounded-[50%] border-2 border-dashed border-white/40" />
              <span className="absolute inset-x-0 top-[28%] text-center text-base font-bold tracking-[0.2em] text-white/70">ĐẦU</span>
              <span className="absolute inset-x-4 top-[58%] bottom-[8%] rounded-2xl border-2 border-dashed border-white/30 bg-white/5" />
              <span className="absolute inset-x-0 top-[64%] text-center text-base font-bold tracking-[0.15em] text-white/70">ÁO ĐỒNG PHỤC</span>
              <span className="absolute inset-x-0 top-[71%] text-center text-xs font-medium text-white/50">để hở logo trước ngực</span>
            </div>
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
        {/* Màn hình chờ (v1.21.0): camera TẮT. Chạm chỗ nào trong vùng này cũng bật. */}
        {phase === "standby" && (
          <button
            type="button"
            onClick={() => void wake()}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-slate-950 px-6 text-center"
            aria-label="Chạm để chấm công"
          >
            <span className="grid size-28 place-items-center rounded-full bg-brand-600/15 ring-4 ring-brand-500/40">
              <Icon name="face" className="size-14 text-brand-300" strokeWidth={1.6} />
            </span>
            <span className="text-4xl font-bold tracking-wide sm:text-5xl">CHẠM ĐỂ CHẤM CÔNG</span>
            <span className="text-6xl font-bold tabular-nums text-white/90 sm:text-7xl">
              {now ? now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "--:--"}
            </span>
            <span className="flex items-center gap-2 text-base text-slate-400">
              <Icon name="camera" className="size-5" /> Camera đang tắt
            </span>
            {hint !== "Chạm để chấm công" && <span className="text-lg font-semibold text-amber-300">{hint}</span>}
          </button>
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
