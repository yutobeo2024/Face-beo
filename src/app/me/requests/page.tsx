"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, qs, useApi } from "@/lib/client/api";
import { fmtDateTime, fromLocalInput, relTime, todayStr, toLocalInput } from "@/lib/client/format";
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { CorrectionBadge, REQ_TYPE, ReqStatusBadge } from "@/components/status";
import { useToast } from "@/components/toast";

type Req = {
  id: number;
  type: string;
  status: string;
  fromTime: string;
  toTime: string;
  reason: string;
  createdAt: string;
  decisionNote: string | null;
  approver: { name: string } | null;
  canCancel: boolean;
  correctionAt: string | null;
  correctionKind: string | null;
  executedAt: string | null;
};
type ReqType = "NGHI_PHEP" | "VE_SOM" | "TANG_CA_OT" | "BO_SUNG_CONG";

const TYPES: { type: ReqType; title: string; desc: string }[] = [
  { type: "NGHI_PHEP", title: "Nghỉ phép", desc: "Nghỉ cả ca hoặc một buổi" },
  { type: "VE_SOM", title: "Về sớm", desc: "Rời ca trước giờ kết thúc" },
  { type: "TANG_CA_OT", title: "Tăng ca", desc: "Làm thêm ngoài giờ ca" },
  { type: "BO_SUNG_CONG", title: "Bổ sung công", desc: "Quên chấm vào / ra" },
];

function NewRequest({
  open,
  onClose,
  onDone,
  initialType,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  initialType?: ReqType;
  initialDate?: string;
}) {
  const toast = useToast();
  const [type, setType] = useState<ReqType>(initialType ?? "NGHI_PHEP");
  const [date, setDate] = useState(initialDate ?? todayStr());
  const [kind, setKind] = useState<"IN" | "OUT">("OUT");
  const [at, setAt] = useState("");
  const [shiftRange, setShiftRange] = useState<{ start: string; end: string } | null>(null);
  const isCorrection = type === "BO_SUNG_CONG";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [shiftText, setShiftText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Tự điền giờ theo ca của ngày đã chọn.
  useEffect(() => {
    if (!open || !date) return;
    let cancelled = false;
    api<{ shift: { name: string; startTime: string; endTime: string } | null; fromTime: string; toTime: string }>(
      `/api/requests/prefill${qs({ date, type: type === "BO_SUNG_CONG" ? "NGHI_PHEP" : type })}`,
    )
      .then((r) => {
        if (cancelled) return;
        setFrom(toLocalInput(r.fromTime));
        setTo(toLocalInput(r.toTime));
        setShiftRange(r.shift ? { start: toLocalInput(r.fromTime), end: toLocalInput(r.toTime) } : null);
        setShiftText(r.shift ? `Ca ${r.shift.name} ${r.shift.startTime}–${r.shift.endTime}` : "Ngày này bạn không có ca");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, date, type]);

  // Bổ sung công: gợi ý giờ theo ca (vào = giờ bắt đầu ca, ra = giờ kết thúc ca).
  useEffect(() => {
    if (!isCorrection) return;
    if (shiftRange) setAt(kind === "IN" ? shiftRange.start : shiftRange.end);
    else setAt(`${date}T${kind === "IN" ? "08:00" : "17:00"}`);
  }, [isCorrection, kind, shiftRange, date]);

  async function submit() {
    setErr(null);
    if (reason.trim().length < 10) return setErr("Lý do tối thiểu 10 ký tự");
    if (isCorrection ? !at : !from || !to || to <= from) return setErr(isCorrection ? "Chọn giờ cần bổ sung" : "Giờ kết thúc phải sau giờ bắt đầu");
    setBusy(true);
    try {
      await api("/api/requests", {
        body: isCorrection
          ? { type, correctionAt: fromLocalInput(at), correctionKind: kind, reason: reason.trim() }
          : { type, fromTime: fromLocalInput(from), toTime: fromLocalInput(to), reason: reason.trim() },
      });
      toast.success("Đã gửi đơn — quản lý sẽ nhận thông báo");
      setReason("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo đơn mới"
      footer={
        <Button size="lg" className="w-full sm:w-auto" loading={busy} onClick={submit}>
          Gửi đơn
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Loại đơn">
          {TYPES.map((t) => (
            <button
              key={t.type}
              role="radio"
              aria-checked={type === t.type}
              onClick={() => setType(t.type)}
              className={cx(
                "flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-center transition",
                type === t.type ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-200 text-slate-600 hover:border-slate-300",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {REQ_TYPE[t.type].emoji}
              </span>
              <span className="text-sm font-bold">{t.title}</span>
              <span className="hidden text-[11px] leading-tight text-slate-500 sm:block">{t.desc}</span>
            </button>
          ))}
        </div>
        <Field label="Ngày" hint={shiftText ?? undefined}>
          {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        </Field>
        {isCorrection ? (
          <>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quên chấm">
              {(["IN", "OUT"] as const).map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cx(
                    "rounded-xl border-2 py-2.5 text-sm font-bold transition",
                    kind === k ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-200 text-slate-600",
                  )}
                >
                  {k === "IN" ? "Quên chấm VÀO" : "Quên chấm RA"}
                </button>
              ))}
            </div>
            <Field label="Giờ thực tế cần bổ sung" hint="Quản lý duyệt, sau đó Nhân sự chấm tay theo giờ này. Chỉ bổ sung trong vòng 3 ngày.">
              {(id) => <input id={id} type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} />}
            </Field>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Từ">{(id) => <input id={id} type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="Đến">{(id) => <input id={id} type="datetime-local" className="input" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
        )}
        <Field label="Lý do" hint={`${reason.trim().length}/10 ký tự tối thiểu`}>
          {(id) => <textarea id={id} className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mô tả ngắn lý do…" maxLength={500} />}
        </Field>
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
      </div>
    </Modal>
  );
}

function MyRequestsInner() {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(sp.get("new") === "1");
  const { data, error, loading, reload } = useApi<{ requests: Req[] }>("/api/requests?scope=mine");

  async function cancel(r: Req) {
    if (!confirm(`Hủy đơn #${r.id}?`)) return;
    try {
      await api(`/api/requests/${r.id}/cancel`, { body: {} });
      toast.success("Đã hủy đơn");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Đơn của tôi"
        subtitle="Nghỉ phép, về sớm, tăng ca, bổ sung công."
        actions={
          <Button icon="plus" onClick={() => setOpen(true)} className="w-full sm:w-auto">
            Tạo đơn
          </Button>
        }
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.requests.length ? (
        <Card>
          <EmptyState icon="file" title="Bạn chưa có đơn nào">
            Tạo đơn khi cần nghỉ, về sớm hoặc tăng ca.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => {
            const t = REQ_TYPE[r.type];
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={t?.tone}>
                      {t?.emoji} {t?.label}
                    </Badge>
                    <ReqStatusBadge status={r.status} />
                    <CorrectionBadge r={r} />
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    #{r.id} · {relTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-800 tabular-nums">
                  {r.type === "BO_SUNG_CONG" && r.correctionAt
                    ? `Bổ sung ${r.correctionKind === "OUT" ? "giờ ra" : "giờ vào"} lúc ${fmtDateTime(r.correctionAt)}`
                    : `${fmtDateTime(r.fromTime)} → ${fmtDateTime(r.toTime)}`}
                </p>
                <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
                {r.decisionNote && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <b>{r.approver?.name ?? "Quản lý"}:</b> {r.decisionNote}
                  </p>
                )}
                {r.canCancel && (
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="secondary" className="text-rose-700" onClick={() => cancel(r)}>
                      Hủy đơn
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <NewRequest
        initialType={sp.get("type") === "BO_SUNG_CONG" ? "BO_SUNG_CONG" : undefined}
        initialDate={/^d{4}-d{2}-d{2}$/.test(sp.get("date") ?? "") ? sp.get("date")! : undefined}
        open={open}
        onClose={() => {
          setOpen(false);
          if (sp.get("new")) router.replace("/me/requests");
        }}
        onDone={() => {
          setOpen(false);
          router.replace("/me/requests");
          void reload();
        }}
      />
    </>
  );
}

export default function MyRequestsPage() {
  return (
    <Suspense>
      <MyRequestsInner />
    </Suspense>
  );
}
