"use client";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Button, Card, cx, ErrorBox, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useCan } from "../../admin-nav";

type Cap = { key: string; group: string; label: string; locked?: boolean };
type Resp = { capabilities: Cap[]; roles: string[]; matrix: Record<string, string[]>; defaults: Record<string, string[]> };

const ROLE_LABEL: Record<string, string> = { HR: "Nhân sự", MANAGER: "Quản lý", EMPLOYEE: "Nhân viên" };

export default function PermissionsPage() {
  const can = useCan();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Resp>(can("permissions.manage") ? "/api/permissions" : null);
  const [draft, setDraft] = useState<Record<string, Set<string>> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.roles.map((r) => [r, new Set(data.matrix[r] ?? [])])));
  }, [data]);

  const groups = useMemo(() => {
    const m = new Map<string, Cap[]>();
    for (const c of data?.capabilities ?? []) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return [...m.entries()];
  }, [data]);

  const changes = useMemo(() => {
    if (!data || !draft) return 0;
    let n = 0;
    for (const r of data.roles) {
      const before = new Set(data.matrix[r] ?? []);
      for (const c of draft[r]) if (!before.has(c)) n++;
      for (const c of before) if (!draft[r].has(c)) n++;
    }
    return n;
  }, [data, draft]);

  function toggle(role: string, cap: string) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [role]: new Set(d[role]) };
      if (next[role].has(cap)) next[role].delete(cap);
      else next[role].add(cap);
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const matrix = Object.fromEntries(Object.entries(draft).map(([r, s]) => [r, [...s]]));
      await api("/api/permissions", { method: "PUT", body: { matrix, reason: reason.trim() } });
      toast.success("Đã lưu phân quyền — có hiệu lực ngay");
      setConfirm(false);
      setReason("");
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!can("permissions.manage")) return <ErrorBox message="Chỉ Quản trị được sửa phân quyền." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data || !draft) return <Loading />;

  return (
    <>
      <PageHeader
        title="Phân quyền"
        subtitle="Bật/tắt quyền cho từng vai trò. Quản trị luôn có mọi quyền; các quyền hệ thống 🔒 chỉ dành cho Quản trị."
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => setDraft(Object.fromEntries(data.roles.map((r) => [r, new Set(data.defaults[r] ?? [])])))}
            >
              Mặc định
            </Button>
            <Button icon="check" disabled={!changes} onClick={() => setConfirm(true)}>
              Lưu {changes ? `(${changes})` : ""}
            </Button>
          </>
        }
      />

      <Card className="mb-3 flex items-start gap-3 bg-amber-50/60 p-4 text-sm text-amber-900">
        <Icon name="shield" className="mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p>
            <b>Phạm vi dữ liệu không đổi theo ma trận:</b> Quản trị và Nhân sự thấy toàn công ty, Quản lý chỉ thấy phòng mình quản lý, Nhân viên chỉ thấy dữ liệu của mình.
          </p>
          <p>Luật cố định: không ai tự duyệt đơn của mình; chỉ Quản trị gán được vai trò Nhân sự / Quản trị. Mỗi lần lưu được ghi nhật ký và gửi vào nhóm Zalo.</p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="scroll-x">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Quyền</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Quản trị</th>
                {data.roles.map((r) => (
                  <th key={r} className="border-b border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase">
                    {ROLE_LABEL[r] ?? r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, caps]) => (
                <GroupRows key={group} group={group} caps={caps} roles={data.roles} draft={draft} saved={data.matrix} onToggle={toggle} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Lưu ${changes} thay đổi phân quyền`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Hủy
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={save}>
              Xác nhận lưu
            </Button>
          </>
        }
      >
        <Field label="Lý do thay đổi (bắt buộc, gửi vào nhóm Zalo)">
          {(id) => <textarea id={id} className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Cho phép quản lý enroll khuôn mặt phòng mình" autoFocus />}
        </Field>
      </Modal>
    </>
  );
}

function GroupRows({
  group,
  caps,
  roles,
  draft,
  saved,
  onToggle,
}: {
  group: string;
  caps: Cap[];
  roles: string[];
  draft: Record<string, Set<string>>;
  saved: Record<string, string[]>;
  onToggle: (role: string, cap: string) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={roles.length + 2} className="sticky left-0 border-b border-slate-100 bg-slate-100/70 px-4 py-1.5 text-xs font-bold tracking-wide text-slate-600 uppercase">
          {group}
        </td>
      </tr>
      {caps.map((c) => (
        <tr key={c.key}>
          <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5">
            <p className="font-medium text-slate-800">
              {c.label} {c.locked && <span title="Chỉ Quản trị">🔒</span>}
            </p>
            <p className="font-mono text-[11px] text-slate-400">{c.key}</p>
          </td>
          <td className="border-b border-slate-100 text-center">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-brand-700 text-white" title="Quản trị luôn có quyền này">
              <Icon name="check" className="size-4" strokeWidth={3} />
            </span>
          </td>
          {roles.map((r) => {
            const on = draft[r]?.has(c.key);
            const changed = on !== (saved[r] ?? []).includes(c.key);
            return (
              <td key={r} className={cx("border-b border-slate-100 text-center", changed && "bg-amber-50")}>
                {c.locked ? (
                  <span className="text-slate-300" title="Khóa: chỉ Quản trị">
                    —
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    className="size-5 cursor-pointer accent-brand-700"
                    checked={!!on}
                    onChange={() => onToggle(r, c.key)}
                    aria-label={`${c.label} — ${ROLE_LABEL[r] ?? r}`}
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
