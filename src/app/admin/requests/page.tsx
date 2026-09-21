"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { fmtDateTime, fromLocalInput, relTime, toLocalInput } from "@/lib/client/format";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Segmented } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { CorrectionBadge, REQ_TYPE, ReqStatusBadge } from "@/components/status";
import { useCan } from "../admin-nav";
import { useToast } from "@/components/toast";

type Req = {
  id: number;
  type: string;
  status: string;
  fromTime: string;
  toTime: string;
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  canExecute: boolean;
  step1?: boolean;
  correctionAt: string | null;
  correctionKind: string | null;
  executedAt: string | null;
  employee: { id: number; code: string; name: string; department: { name: string } };
  approver: { name: string } | null;
  managerApprover: { name: string } | null;
  managerDecidedAt: string | null;
  managerNote: string | null;
};

function RequestsInner() {
  const toast = useToast();
  const sp = useSearchParams();
  const can = useCan();
  const [status, setStatus] = useState(sp.get("view") === "execute" ? "EXECUTE" : (sp.get("status") ?? "PENDING"));
  const [exec, setExec] = useState<{ r: Req; at: string; note: string } | null>(null);
  const [dept, setDept] = useState("");
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<{ requests: Req[] }>(
    `/api/requests${qs(status === "EXECUTE" ? { scope: "team", view: "execute", departmentId: dept } : { scope: "team", status: status === "ALL" ? "" : status, departmentId: dept })}`,
  );

  async function decide(r: Req, action: "APPROVE" | "REJECT", decisionNote?: string) {
    setBusy(r.id);
    try {
      const res = await api<{ recomputedDays: number; request: { status: string } }>(`/api/requests/${r.id}/decide`, { body: { action, note: decisionNote } });
      toast.success(
        action === "REJECT"
          ? `Đã từ chối đơn #${r.id}`
          : res.request.status === "MANAGER_APPROVED"
            ? `Đã duyệt bước 1 đơn #${r.id} — chờ Nhân sự duyệt`
            : `Đã duyệt đơn #${r.id}${res.recomputedDays ? ` · tính lại ${res.recomputedDays} ngày công` : ""}`,
      );
      setRejecting(null);
      setNote("");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    if (!exec) return;
    setBusy(exec.r.id);
    try {
      await api(`/api/requests/${exec.r.id}/execute`, { body: { checkTime: fromLocalInput(exec.at), note: exec.note.trim() || undefined } });
      toast.success(`Đã chấm tay theo đơn #${exec.r.id}`);
      setExec(null);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Đơn từ" subtitle="Duyệt hoặc từ chối đơn nghỉ phép, về sớm, tăng ca của nhân viên bạn quản lý." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "PENDING", label: "Chờ duyệt" },
            { value: "APPROVED", label: "Đã duyệt" },
            { value: "REJECTED", label: "Từ chối" },
            { value: "ALL", label: "Tất cả" },
            ...(can("attendance.executeCorrection") ? [{ value: "EXECUTE", label: "Chờ chấm tay" }] : []),
          ]}
        />
        <DeptSelect value={dept} onChange={setDept} className="w-full sm:w-56" />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.requests.length ? (
        <Card>
          <EmptyState icon="inbox" title={status === "PENDING" ? "Không có đơn nào chờ duyệt" : "Không có đơn"} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.requests.map((r) => {
            const t = REQ_TYPE[r.type];
            return (
              <Card key={r.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={r.employee.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-semibold text-slate-800">{r.employee.name}</p>
                      <span className="text-xs text-slate-400">
                        {r.employee.code} · {r.employee.department.name}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={t?.tone}>
                        {t?.emoji} {t?.label ?? r.type}
                      </Badge>
                      <ReqStatusBadge status={r.status} />
                      <CorrectionBadge r={r} />
                      <span className="text-xs text-slate-400">#{r.id} · {relTime(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                  <p className="font-semibold text-slate-700 tabular-nums">
                    {r.type === "BO_SUNG_CONG" && r.correctionAt
                      ? `Bổ sung ${r.correctionKind === "OUT" ? "giờ ra" : "giờ vào"} lúc ${fmtDateTime(r.correctionAt)}`
                      : `${fmtDateTime(r.fromTime)} → ${fmtDateTime(r.toTime)}`}
                  </p>
                  <p className="mt-1 text-slate-600">{r.reason}</p>
                </div>
                {r.managerApprover && (
                  <p className="mt-2 text-xs text-slate-500">
                    Bước 1: trưởng phòng {r.managerApprover.name} đã duyệt
                    {r.managerDecidedAt ? ` · ${fmtDateTime(r.managerDecidedAt)}` : ""}
                    {r.managerNote ? ` · “${r.managerNote}”` : ""}
                  </p>
                )}
                {r.status !== "PENDING" && r.status !== "MANAGER_APPROVED" && (r.approver || r.decisionNote) && (
                  <p className="mt-2 text-xs text-slate-500">
                    {r.approver ? `Xử lý bởi ${r.approver.name}` : ""}
                    {r.decidedAt ? ` · ${fmtDateTime(r.decidedAt)}` : ""}
                    {r.decisionNote ? ` · “${r.decisionNote}”` : ""}
                  </p>
                )}
                {r.canDecide && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="secondary" className="text-rose-700" onClick={() => setRejecting(r)} disabled={busy === r.id}>
                      Từ chối
                    </Button>
                    <Button variant="success" icon="check" onClick={() => decide(r, "APPROVE")} loading={busy === r.id}>
                      {r.step1 ? "Duyệt bước 1" : "Duyệt"}
                    </Button>
                  </div>
                )}
                {(r.status === "PENDING" || r.status === "MANAGER_APPROVED") && !r.canDecide && (
                  <p className="mt-3 text-xs text-slate-500">{r.status === "MANAGER_APPROVED" ? "Đang chờ Nhân sự duyệt bước 2." : "Đơn này do người khác duyệt."}</p>
                )}
                {r.canExecute && (
                  <Button className="mt-3" icon="clock" onClick={() => setExec({ r, at: toLocalInput(r.correctionAt!), note: "" })}>
                    Thực hiện chấm tay
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!exec}
        onClose={() => setExec(null)}
        title={`Chấm tay theo đơn #${exec?.r.id ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExec(null)}>
              Hủy
            </Button>
            <Button loading={busy === exec?.r.id} onClick={execute}>
              Xác nhận chấm tay
            </Button>
          </>
        }
      >
        {exec && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {exec.r.employee.name} ({exec.r.employee.code}) — {exec.r.correctionKind === "OUT" ? "quên chấm ra" : "quên chấm vào"}. Lý do: “{exec.r.reason}”
            </p>
            <Field label="Giờ chấm tay" hint="Mặc định là giờ nhân viên ghi trong đơn. Nếu sửa, ghi rõ lý do bên dưới.">
              {(id) => <input id={id} type="datetime-local" className="input" value={exec.at} onChange={(e) => setExec({ ...exec, at: e.target.value })} />}
            </Field>
            <Field label="Ghi chú (tùy chọn, gửi vào nhóm Zalo)">
              {(id) => <textarea id={id} className="input min-h-20" value={exec.note} onChange={(e) => setExec({ ...exec, note: e.target.value })} />}
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Từ chối đơn #${rejecting?.id ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Hủy
            </Button>
            <Button variant="danger" disabled={note.trim().length < 3} loading={busy === rejecting?.id} onClick={() => rejecting && decide(rejecting, "REJECT", note.trim())}>
              Xác nhận từ chối
            </Button>
          </>
        }
      >
        <Field label="Lý do từ chối (bắt buộc)" hint="Nhân viên sẽ nhận được ghi chú này qua Zalo.">
          {(id) => <textarea id={id} className="input min-h-28" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Tuần này thiếu người, vui lòng chọn ngày khác" autoFocus />}
        </Field>
      </Modal>
    </>
  );
}

export default function AdminRequestsPage() {
  return (
    <Suspense>
      <RequestsInner />
    </Suspense>
  );
}
