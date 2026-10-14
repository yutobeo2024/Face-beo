"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Badge, Button, Card, CardHeader, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ProjectFormModal } from "@/components/tasks/project-form-modal";
import { useProject } from "@/components/tasks/use-project";
import { api, useApi, useDebounced } from "@/lib/client/api";
import { PROJECT_COLORS, PROJECT_ROLE_HINT, PROJECT_ROLE_LABEL, ZALO_PREF_KEYS, ZALO_PREF_LABEL, type MemberDto, type ProjectRole } from "@/lib/tasks/types";
import { useMe } from "../../../me-nav";

type Pool = { people: { id: number; code: string; name: string; department: string }[] };
const SETTABLE: ProjectRole[] = ["ADMIN", "MEMBER", "CONTRIBUTOR"];

export default function ProjectSettingsPage() {
  const me = useMe();
  const toast = useToast();
  const router = useRouter();
  const { data, reload, setData, projectId } = useProject();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<MemberDto | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useGroupName(data?.project.zaloGroupId ?? null, projectId, !!data?.perms.zaloGroup);
  if (!data) return null;
  const { project, members, perms } = data;
  const deleted = !!project.deletedAt;

  const setMembers = (list: MemberDto[]) => setData((d) => (d ? { ...d, members: list } : d));
  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeRole = (m: MemberDto, role: ProjectRole) =>
    act(async () => {
      setMembers((await api<{ members: MemberDto[] }>(`/api/tasks/projects/${projectId}/members`, { method: "PUT", body: { members: [{ employeeId: m.id, role }] } })).members);
      if (m.id === me.id) await reload(); // tự hạ vai trò ⇒ cờ quyền của trang phải tính lại
    }, "Đã đổi vai trò");
  const removeMember = (m: MemberDto) => {
    const self = m.id === me.id;
    if (!confirm(self ? "Rời khỏi dự án này?" : `Gỡ ${m.name} khỏi dự án? Người này cũng bị gỡ khỏi các việc được giao.`)) return;
    return act(async () => {
      const r = await api<{ members: MemberDto[] }>(`/api/tasks/projects/${projectId}/members/${m.id}`, { method: "DELETE" });
      if (self) router.push("/me/tasks");
      else setMembers(r.members);
    }, self ? "Đã rời dự án" : "Đã gỡ thành viên");
  };
  const removeProject = () => {
    if (!confirm(`Xóa dự án "${project.name}"? Dự án vào thùng rác, Chủ dự án khôi phục được.`)) return;
    return act(async () => {
      await api(`/api/tasks/projects/${projectId}`, { method: "DELETE" });
      router.push("/me/tasks");
    }, "Đã xóa dự án");
  };
  const restore = () => act(async () => void (await api(`/api/tasks/projects/${projectId}/restore`, { body: {} }), await reload()), "Đã khôi phục dự án");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden">
        <CardHeader
          title={`Thành viên (${members.length})`}
          actions={
            perms.manage && !deleted ? (
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
                Thêm người
              </Button>
            ) : undefined
          }
        />
        <ul className="divide-y divide-slate-100">
          {members.map((m) => {
            const editable = perms.manage && !deleted && m.role !== "OWNER" && (perms.own || m.role !== "ADMIN" || m.id === me.id);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Avatar name={m.name} src={m.avatarUrl} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {m.name} {m.id === me.id && <span className="font-normal text-slate-400">(bạn)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.code}
                    {!m.active && " · đã nghỉ việc"}
                  </p>
                </div>
                {editable ? (
                  <Select className="h-9 w-40" value={m.role} disabled={busy} onChange={(e) => void changeRole(m, e.target.value as ProjectRole)}>
                    {SETTABLE.map((r) => (
                      <option key={r} value={r}>
                        {PROJECT_ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={m.role === "OWNER" ? "brand" : "neutral"}>{PROJECT_ROLE_LABEL[m.role]}</Badge>
                )}
                {perms.own && m.role !== "OWNER" && m.active && !deleted && (
                  <Button size="sm" variant="ghost" onClick={() => setTransfer(m)}>
                    Chuyển chủ
                  </Button>
                )}
                {((editable && m.id !== me.id) || (m.id === me.id && m.role !== "OWNER")) && !deleted && (
                  <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => void removeMember(m)}>
                    {m.id === me.id ? "Rời dự án" : "Gỡ"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {(Object.keys(PROJECT_ROLE_LABEL) as ProjectRole[]).map((r) => (
            <p key={r}>
              <b>{PROJECT_ROLE_LABEL[r]}</b>: {PROJECT_ROLE_HINT[r]}
            </p>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold text-slate-800">Thông tin dự án</p>
            {perms.manage && !deleted && (
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)}>
                Sửa
              </Button>
            )}
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Màu</dt>
              <dd>{PROJECT_COLORS[project.color].label}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Mô tả</dt>
              <dd className="whitespace-pre-wrap">{project.description || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">Nhóm Zalo</dt>
              <dd>{project.zaloGroupId ? (groups ?? project.zaloGroupId) : "Không gửi Zalo"}</dd>
            </div>
            {project.zaloGroupId && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-slate-500">Gửi khi</dt>
                <dd>{ZALO_PREF_KEYS.filter((k) => project.zaloPrefs[k]).map((k) => ZALO_PREF_LABEL[k]).join("; ") || "Không gửi gì"}</dd>
              </div>
            )}
          </dl>
        </Card>
        {(perms.own || (deleted && perms.restore)) && (
          <Card className="border-rose-200 p-4">
            <p className="mb-2 font-semibold text-rose-700">Vùng nguy hiểm</p>
            {deleted ? (
              <Button variant="success" onClick={() => void restore()} loading={busy}>
                Khôi phục dự án
              </Button>
            ) : (
              <Button variant="danger" icon="trash" onClick={() => void removeProject()} loading={busy}>
                Xóa dự án
              </Button>
            )}
          </Card>
        )}
      </div>

      {editing && (
        <ProjectFormModal
          open
          project={project}
          canRename={perms.own}
          canPickGroup={!!perms.zaloGroup}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setEditing(false);
            setData((d) => (d ? { ...d, project: p } : d));
          }}
        />
      )}
      {adding && <AddMembers projectId={projectId} onClose={() => setAdding(false)} onSaved={(list) => setMembers(list)} />}
      {transfer && (
        <Modal
          open
          onClose={() => setTransfer(null)}
          title="Chuyển quyền sở hữu"
          footer={
            <>
              <Button variant="secondary" onClick={() => setTransfer(null)}>
                Hủy
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    setMembers((await api<{ members: MemberDto[] }>(`/api/tasks/projects/${projectId}/transfer-owner`, { body: { employeeId: transfer.id } })).members);
                    setTransfer(null);
                    await reload();
                  }, "Đã chuyển quyền sở hữu")
                }
              >
                Chuyển cho {transfer.name}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            <b>{transfer.name}</b> sẽ thành Chủ dự án. Bạn trở thành Quản lý dự án và không còn đổi tên / xóa dự án được nữa.
          </p>
        </Modal>
      )}
    </div>
  );
}

function useGroupName(groupId: string | null, projectId: number, manage: boolean) {
  const { data } = useApi<{ groups: { groupId: string; name: string }[] }>(groupId && manage ? `/api/tasks/zalo-groups?projectId=${projectId}` : null);
  return data?.groups.find((g) => g.groupId === groupId)?.name;
}

function AddMembers({ projectId, onClose, onSaved }: { projectId: number; onClose: () => void; onSaved: (m: MemberDto[]) => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [picked, setPicked] = useState<Map<number, ProjectRole>>(new Map());
  const [busy, setBusy] = useState(false);
  const pool = useApi<Pool>(`/api/tasks/members-pool?projectId=${projectId}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`);
  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Map(p);
      if (n.has(id)) n.delete(id);
      else n.set(id, "MEMBER");
      return n;
    });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ members: MemberDto[] }>(`/api/tasks/projects/${projectId}/members`, { method: "PUT", body: { members: [...picked].map(([employeeId, role]) => ({ employeeId, role })) } });
      toast.success(`Đã thêm ${picked.size} người`);
      onSaved(r.members);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Thêm thành viên"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save} loading={busy} disabled={!picked.size}>
            Thêm {picked.size || ""} người
          </Button>
        </>
      }
    >
      <input className="input mb-3" autoFocus placeholder="Tìm theo mã NV hoặc tên…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-[50dvh] divide-y divide-slate-100 overflow-y-auto">
        {pool.data?.people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <input type="checkbox" className="size-4" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Chọn ${p.name}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.code} · {p.department}
              </p>
            </div>
            {picked.has(p.id) && (
              <Select className="h-8 w-36 py-0 text-sm" value={picked.get(p.id)} onChange={(e) => setPicked((m) => new Map(m).set(p.id, e.target.value as ProjectRole))}>
                {SETTABLE.map((r) => (
                  <option key={r} value={r}>
                    {PROJECT_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </li>
        ))}
        {pool.data && !pool.data.people.length && <li className="py-6 text-center text-sm text-slate-500">Không còn ai để thêm.</li>}
      </ul>
    </Modal>
  );
}
