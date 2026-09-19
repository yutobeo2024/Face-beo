"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, useApi } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";
import { checkGate, loadEngine, openCamera, stopCamera, beep } from "@/lib/face/engine";
import { Badge, Button, Card, cx, ErrorBox, Loading, Modal, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useCan } from "../../../admin-nav";

type Pose = "FRONT" | "LEFT" | "RIGHT" | "UP" | "DOWN";
const POSES: { pose: Pose; label: string; hint: string }[] = [
  { pose: "FRONT", label: "Nhìn thẳng", hint: "Nhìn thẳng vào camera" },
  { pose: "LEFT", label: "Hơi trái", hint: "Quay mặt nhẹ sang một bên" },
  { pose: "RIGHT", label: "Hơi phải", hint: "Quay mặt nhẹ sang bên còn lại" },
  { pose: "UP", label: "Hơi ngẩng", hint: "Ngẩng mặt lên một chút" },
  { pose: "DOWN", label: "Hơi cúi", hint: "Cúi mặt xuống một chút" },
];
type Sample = { pose: Pose; descriptor: number[]; faceSize: number; thumb: string; yaw: number; pitch: number };
type Emp = { employee: { id: number; code: string; name: string; biometricConsentAt: string | null; faceCount: number; department: { name: string } } };

const CONSENT_TEXT = [
  "Mục đích: dữ liệu khuôn mặt chỉ dùng để chấm công tại kiosk của công ty.",
  "Loại dữ liệu: vector đặc trưng khuôn mặt (embedding) được mã hóa AES-256-GCM. Hệ thống KHÔNG lưu ảnh enroll.",
  "Ảnh chụp lúc chấm công (snapshot) được lưu tối đa 90 ngày để đối soát, chỉ quản trị, bộ phận nhân sự và quản lý trực tiếp xem được.",
  "Thời hạn lưu: trong thời gian làm việc; xóa trong vòng 30 ngày khi nghỉ việc.",
  "Quyền của bạn: có thể rút lại đồng ý bất cứ lúc nào — dữ liệu khuôn mặt bị xóa ngay và bạn chuyển sang chấm công thủ công.",
];

function poseOk(pose: Pose, yaw: number, pitch: number, taken: Sample[]): boolean {
  const left = taken.find((s) => s.pose === "LEFT");
  const up = taken.find((s) => s.pose === "UP");
  switch (pose) {
    case "FRONT":
      return Math.abs(yaw) < 8 && Math.abs(pitch) < 10;
    case "LEFT":
      return Math.abs(yaw) >= 8 && Math.abs(yaw) <= 32;
    case "RIGHT":
      return Math.abs(yaw) >= 8 && Math.abs(yaw) <= 32 && (!left || Math.sign(yaw) !== Math.sign(left.yaw));
    case "UP":
      return Math.abs(pitch) >= 6 && Math.abs(pitch) <= 30;
    case "DOWN":
      return Math.abs(pitch) >= 6 && Math.abs(pitch) <= 30 && (!up || Math.sign(pitch) !== Math.sign(up.pitch));
  }
}

export default function EnrollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Emp>(`/api/employees/${id}`);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"consent" | "capture" | "done">("consent");
  const [status, setStatus] = useState("Chuẩn bị camera…");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [dup, setDup] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<Sample[]>([]);
  const streak = useRef(0);
  const running = useRef(false);

  const emp = data?.employee;
  useEffect(() => {
    if (emp?.biometricConsentAt && phase === "consent") setAgree(true);
  }, [emp?.biometricConsentAt, phase]);

  async function giveConsent() {
    setBusy(true);
    try {
      if (!emp?.biometricConsentAt) await api(`/api/employees/${id}/consent`, { body: {} });
      setPhase("capture");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loop = useCallback(async () => {
    const video = videoRef.current!;
    const overlay = overlayRef.current!;
    const scratch = scratchRef.current!;
    const human = await loadEngine(setStatus);
    running.current = true;
    while (running.current && samplesRef.current.length < 5) {
      if (video.readyState < 2) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const res = await human.detect(video);
      const step = POSES[samplesRef.current.length];
      const g = checkGate(res.face, video, scratch, { minFace: 200, maxAngle: 32, checkLight: true });
      // Vẽ khung
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const good = g.ok && poseOk(step.pose, g.yawDeg, g.pitchDeg, samplesRef.current);
      if (g.face) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = good ? "#10b981" : "#f59e0b";
        ctx.strokeRect(...g.face.box);
      }
      if (!g.ok) {
        streak.current = 0;
        setStatus(g.reason ?? "");
      } else if (!good) {
        streak.current = 0;
        setStatus(step.hint);
      } else if (++streak.current >= 3) {
        const f = g.face!;
        const t = document.createElement("canvas");
        t.width = 96;
        t.height = 96;
        t.getContext("2d")!.drawImage(video, f.box[0], f.box[1], f.box[2], f.box[3], 0, 0, 96, 96);
        const s: Sample = { pose: step.pose, descriptor: Array.from(f.embedding!), faceSize: Math.round(f.box[2]), thumb: t.toDataURL("image/jpeg", 0.6), yaw: g.yawDeg, pitch: g.pitchDeg };
        samplesRef.current = [...samplesRef.current, s];
        setSamples(samplesRef.current);
        streak.current = 0;
        beep("ok");
        setStatus(samplesRef.current.length < 5 ? POSES[samplesRef.current.length].hint : "Đã đủ 5 mẫu");
        await new Promise((r) => setTimeout(r, 700));
      } else {
        setStatus("Giữ yên…");
      }
    }
    running.current = false;
  }, []);

  useEffect(() => {
    if (phase !== "capture") return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await openCamera(videoRef.current!);
        if (cancelled) return stopCamera(stream);
        await loop();
      } catch (e) {
        setStatus((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      running.current = false;
      stopCamera(stream);
    };
  }, [phase, loop]);

  function retake(i: number) {
    samplesRef.current = samplesRef.current.slice(0, i);
    setSamples(samplesRef.current);
    if (!running.current) void loop();
  }

  async function submit(force = false) {
    setBusy(true);
    try {
      await api(`/api/employees/${id}/faces`, {
        body: { samples: samplesRef.current.map(({ pose, descriptor, faceSize }) => ({ pose, descriptor, faceSize })), force },
      });
      toast.success("Đã lưu 5 mẫu khuôn mặt");
      setDup(null);
      setPhase("done");
      void reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setDup(e.message);
      else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!can("faces.enroll")) return <ErrorBox message="Bạn không có quyền enroll khuôn mặt." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !emp) return <Loading />;

  return (
    <>
      <Link href="/admin/employees" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <Icon name="chevronLeft" className="size-4" /> Danh sách nhân viên
      </Link>
      <PageHeader
        title={`Enroll khuôn mặt — ${emp.name}`}
        subtitle={`${emp.code} · ${emp.department.name}${emp.faceCount ? ` · hiện có ${emp.faceCount} mẫu (sẽ được thay thế)` : ""}`}
      />

      {phase === "consent" && (
        <Card className="max-w-2xl p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Icon name="shield" className="text-brand-700" /> Đồng ý xử lý dữ liệu sinh trắc học
          </h2>
          <p className="mt-1 text-sm text-slate-500">Nhân viên đọc và tự tick đồng ý trên thiết bị này (theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15).</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {CONSENT_TEXT.map((t) => (
              <li key={t} className="flex gap-2">
                <Icon name="check" className="mt-0.5 size-4 shrink-0 text-brand-600" /> {t}
              </li>
            ))}
          </ul>
          {emp.biometricConsentAt && <p className="mt-4 text-sm text-emerald-700">✓ Đã đồng ý lúc {fmtDateTime(emp.biometricConsentAt)}</p>}
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" className="mt-0.5 size-5 accent-brand-700" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm font-medium text-slate-800">
              Tôi, {emp.name}, đã đọc và đồng ý cho công ty xử lý dữ liệu khuôn mặt của tôi cho mục đích chấm công.
            </span>
          </label>
          <Button className="mt-4 w-full sm:w-auto" size="lg" disabled={!agree} loading={busy} onClick={giveConsent}>
            Tiếp tục chụp mẫu
          </Button>
        </Card>
      )}

      {phase === "capture" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="overflow-hidden p-0">
            <div className="relative aspect-video w-full bg-slate-900">
              <video ref={videoRef} className="absolute inset-0 size-full -scale-x-100 object-cover" playsInline muted />
              <canvas ref={overlayRef} className="absolute inset-0 size-full -scale-x-100 object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-center">
                <p className="text-lg font-bold text-white drop-shadow sm:text-xl">{samples.length < 5 ? `${samples.length + 1}/5 · ${POSES[samples.length].label}` : "Hoàn tất"}</p>
                <p className="text-sm text-white/85">{status}</p>
              </div>
            </div>
            <canvas ref={scratchRef} className="hidden" />
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 font-semibold text-slate-800">Mẫu đã chụp</h3>
            <ol className="grid grid-cols-5 gap-2 lg:grid-cols-1">
              {POSES.map((p, i) => {
                const s = samples[i];
                return (
                  <li key={p.pose} className={cx("flex flex-col items-center gap-2 rounded-xl p-1.5 lg:flex-row lg:p-2", i === samples.length ? "bg-brand-50 ring-1 ring-brand-200" : "")}>
                    {s ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumb} alt="" className="size-12 -scale-x-100 rounded-lg object-cover" />
                    ) : (
                      <span className="flex size-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <Icon name="face" />
                      </span>
                    )}
                    <div className="hidden min-w-0 flex-1 lg:block">
                      <p className="text-sm font-semibold text-slate-800">{p.label}</p>
                      <p className="text-xs text-slate-500">{s ? `mặt ${s.faceSize}px` : p.hint}</p>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 lg:hidden">{p.label}</span>
                    {s && (
                      <button className="hidden text-xs font-semibold text-brand-700 hover:underline lg:block" onClick={() => retake(i)}>
                        Chụp lại
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 flex flex-col gap-2">
              <Button size="lg" disabled={samples.length < 5} loading={busy} onClick={() => submit(false)} icon="check">
                Lưu 5 mẫu
              </Button>
              {samples.length > 0 && (
                <Button variant="ghost" onClick={() => retake(0)}>
                  Chụp lại từ đầu
                </Button>
              )}
              <p className="text-xs text-slate-500">Chỉ gửi vector đặc trưng lên máy chủ, ảnh xem trước không được lưu.</p>
            </div>
          </Card>
        </div>
      )}

      {phase === "done" && (
        <Card className="max-w-xl p-6 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check" className="size-8" strokeWidth={2.5} />
          </div>
          <h2 className="text-lg font-bold">Enroll thành công</h2>
          <p className="mt-1 text-sm text-slate-500">{emp.name} đã có thể chấm công tại kiosk.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Badge tone="ontime">{emp.faceCount} mẫu</Badge>
          </div>
          <Link href="/admin/employees" className="mt-5 inline-flex h-11 items-center rounded-xl bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800">
            Về danh sách
          </Link>
        </Card>
      )}

      <Modal
        open={!!dup}
        onClose={() => setDup(null)}
        title="Cảnh báo trùng khuôn mặt"
        footer={
          <>
            <Button variant="secondary" onClick={() => (setDup(null), retake(0))}>
              Chụp lại
            </Button>
            <Button variant="danger" loading={busy} onClick={() => submit(true)}>
              Vẫn lưu
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{dup}</p>
        <p className="mt-2 text-sm text-slate-500">Có thể là người khác đang đứng trước camera hoặc hai nhân viên rất giống nhau. Cảnh báo này đã được ghi vào nhật ký kiểm toán.</p>
      </Modal>
    </>
  );
}
