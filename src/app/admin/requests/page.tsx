"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api, qs, useApi } from "@/lib/client/api";
import { fmtDateTime, relTime } from "@/lib/client/format";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Segmented } from "@/components/ui";
import { DeptSelect } from "@/components/dept-select";
import { REQ_TYPE, ReqStatusBadge } from "@/components/status";
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
  employee: { id: number; code: string; name: string; department: { name: string } };
  approver: { name: string } | null;
};

function RequestsInner() {
  const toast = useToast();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "PENDING");
  const [dept, setDept] = useState("");
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<{ requests: Req[] }>(`/api/requests${qs({ scope: "team", status: status === "ALL" ? "" : status, departmentId: dept })}`);

  async function decide(r: Req, action: "APPROVE" | "REJECT", decisionNote?: string) {
    setBusy(r.id);
    try {
      const res = await api<{ recomputedDays: number }>(`/api/requests/${r.id}/decide`, { body: { action, note: decisionNote } });
      toast.success(action === "APPROVE" ? `Đã duyệt đơn #${r.id}${res.recomputedDays ? ` · tính lại ${res.recomputedDays} ngày công` : ""}` : `Đã từ chối đơn #${r.id}`);
      setRejecting(null);
      setNote("");
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
                      <span className="text-xs text-slate-400">#{r.id} · {relTime(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                  <p className="font-semibold text-slate-700 tabular-nums">
                    {fmtDateTime(r.fromTime)} → {fmtDateTime(r.toTime)}
                  </p>
                  <p className="mt-1 text-slate-600">{r.reason}</p>
                </div>
                {r.status !== "PENDING" && (r.approver || r.decisionNote) && (
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
                      Duyệt
                    </Button>
                  </div>
                )}
                {r.status === "PENDING" && !r.canDecide && <p className="mt-3 text-xs text-slate-500">Đơn này do người khác duyệt.</p>}
              </Card>
            );
          })}
        </div>
      )}

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
