"use client";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, cx, IconButton, Modal, Segmented, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api, ApiError, useApi } from "@/lib/client/api";
import { fmtDateTime, fromLocalInput, relTime, toLocalInput } from "@/lib/client/format";
import {
  RECURRENCE_LABEL,
  RECURRENCES,
  REMINDER_LABEL,
  REMINDERS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  type CommentDto,
  type MemberDto,
  type TaskDto,
  type TaskStatus,
} from "@/lib/tasks/types";
import { AssigneePicker } from "./create-task-modal";
import { DueText, PriorityBadge, StatusBadge } from "./task-badges";

type Props = {
  task: TaskDto;
  members: MemberDto[];
  allTasks: TaskDto[];
  meId: number;
  canDeleteTask: boolean;
  onChanged: (t: TaskDto) => void;
  onDeleted: (id: number) => void;
  onStatus: (t: TaskDto, s: TaskStatus) => Promise<void>;
  onClose: () => void;
  /** Mở thẳng tab bình luận / làm nổi việc con chưa xong (khi kéo sang Hoàn thành bị chặn). */
  focusSubtasks?: boolean;
};

/** Chi tiết một việc: desktop = panel bên phải, điện thoại = hộp thoại toàn màn hình (Modal wide). */
export function TaskDrawer(props: Props) {
  // Chỉ mở sau một thao tác trên trình duyệt nên đọc thẳng kích thước màn hình (không nháy panel rồi mới đổi sang hộp thoại).
  const [desktop, setDesktop] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [desktop]);
  if (!desktop) {
    return (
      <Modal open onClose={props.onClose} title="Chi tiết công việc" wide>
        <TaskDetail {...props} />
      </Modal>
    );
  }
  return (
    <div className="fixed inset-y-0 right-0 z-[70] flex w-[440px] max-w-full flex-col border-l border-slate-200 bg-white shadow-[var(--shadow-pop)]" role="dialog" aria-label="Chi tiết công việc">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <p className="font-semibold text-slate-800">Chi tiết công việc</p>
        <IconButton icon="x" label="Đóng" onClick={props.onClose} />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <TaskDetail {...props} />
      </div>
    </div>
  );
}

function TaskDetail({ task, members, allTasks, meId, canDeleteTask, onChanged, onDeleted, onStatus, onClose, focusSubtasks }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<"detail" | "comments">("detail");
  const edit = task.perms.edit;

  const patch = async (body: Record<string, unknown>) => {
    try {
      const r = await api<{ task: TaskDto }>(`/api/tasks/${task.id}`, { method: "PATCH", body });
      onChanged(r.task);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const put = async (path: "subtasks" | "dependencies", body: Record<string, unknown>): Promise<void> => {
    try {
      const r = await api<{ task: TaskDto }>(`/api/tasks/${task.id}/${path}`, { method: "PUT", body });
      onChanged(r.task);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Xóa việc "${task.title}"? Không khôi phục được.`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      toast.success("Đã xóa việc");
      onDeleted(task.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DueText dueAt={task.dueAt} status={task.status} />
        {task.parentId && <span className="text-xs text-slate-400">Bản lặp {task.occurrenceDate}</span>}
      </div>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "detail", label: "Chi tiết" },
          { value: "comments", label: `Bình luận${task.commentCount ? ` (${task.commentCount})` : ""}` },
        ]}
      />
      {tab === "comments" ? (
        <Comments task={task} members={members} onPosted={(n) => onChanged({ ...task, commentCount: n })} />
      ) : (
        <div className="space-y-4">
          <InlineText value={task.title} disabled={!edit} className="text-lg font-semibold" onSave={(title) => patch({ title })} />
          <div>
            <p className="label">Trạng thái</p>
            <Select value={task.status} disabled={!edit} onChange={(e) => void onStatus(task, e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Hạn</span>
              <input
                type="datetime-local"
                className="input"
                disabled={!edit}
                defaultValue={toLocalInput(task.dueAt)}
                key={`due${task.dueAt}`}
                onBlur={(e) => e.target.value && fromLocalInput(e.target.value) !== task.dueAt && void patch({ dueAt: fromLocalInput(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="label">Bắt đầu</span>
              <input type="date" className="input" disabled={!edit} defaultValue={task.startDate ?? ""} key={`st${task.startDate}`} onBlur={(e) => (e.target.value || null) !== task.startDate && void patch({ startDate: e.target.value || null })} />
            </label>
            <label className="block">
              <span className="label">Ưu tiên</span>
              <Select value={task.priority} disabled={!edit} onChange={(e) => void patch({ priority: e.target.value })}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label">Nhắc hạn</span>
              <Select value={task.reminder} disabled={!edit} onChange={(e) => void patch({ reminder: e.target.value })}>
                {REMINDERS.map((r) => (
                  <option key={r} value={r}>
                    {REMINDER_LABEL[r]}
                  </option>
                ))}
              </Select>
            </label>
            {!task.parentId && (
              <label className="block">
                <span className="label">Lặp lại</span>
                <Select value={task.recurrence} disabled={!edit} onChange={(e) => void patch({ recurrence: e.target.value })}>
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
          <div>
            <p className="label">Giao cho</p>
            <AssigneePicker
              members={members}
              value={task.assignees.map((a) => a.id)}
              onChange={(ids) => void patch({ assigneeIds: ids })}
              only={task.perms.assign ? undefined : edit ? [meId] : []}
            />
          </div>
          <div>
            <p className="label">Mô tả</p>
            <InlineText value={task.description} multiline disabled={!edit} placeholder="Chưa có mô tả" onSave={(description) => patch({ description })} />
          </div>
          <Subtasks task={task} disabled={!edit} highlight={!!focusSubtasks} onSave={(subtasks) => put("subtasks", { subtasks })} />
          <Dependencies task={task} allTasks={allTasks} disabled={!edit} onSave={(dependsOn) => put("dependencies", { dependsOn })} />
          <p className="text-xs text-slate-400">
            Tạo {fmtDateTime(task.createdAt)} · cập nhật {relTime(task.updatedAt)}
            {task.completedAt ? ` · xong ${fmtDateTime(task.completedAt)}` : ""}
          </p>
          {canDeleteTask && (
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Đóng
              </Button>
              <Button variant="danger" size="sm" icon="trash" onClick={remove}>
                Xóa việc
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineText({ value, onSave, disabled, multiline, className, placeholder }: { value: string; onSave: (v: string) => void; disabled?: boolean; multiline?: boolean; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const next = multiline ? v : v.trim();
    if (next !== value && (multiline || next)) onSave(next);
    else setV(value);
  };
  if (multiline)
    return <textarea className={cx("input min-h-24", className)} value={v} disabled={disabled} placeholder={placeholder} maxLength={5000} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  return <input className={cx("input", className)} value={v} disabled={disabled} maxLength={200} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function Subtasks({ task, disabled: locked, highlight, onSave: save }: { task: TaskDto; disabled: boolean; highlight: boolean; onSave: (s: { text: string; done: boolean }[]) => Promise<void> }) {
  const [text, setText] = useState("");
  // Mỗi lần lưu gửi CẢ danh sách ⇒ khóa ô trong lúc chờ, tích nhanh hai ô liền không làm mất lần tích trước.
  const [saving, setSaving] = useState(false);
  const disabled = locked || saving;
  const onSave = (s: { text: string; done: boolean }[]) => {
    setSaving(true);
    void save(s).finally(() => setSaving(false));
  };
  const list = task.subtasks.map((s) => ({ text: s.text, done: s.done }));
  const done = list.filter((s) => s.done).length;
  return (
    <div className={cx("rounded-xl", highlight && list.some((s) => !s.done) && "ring-2 ring-amber-400 ring-offset-4")}>
      <p className="label">
        Việc con {list.length > 0 && `(${done}/${list.length})`}
      </p>
      <ul className="space-y-1">
        {task.subtasks.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={s.done} disabled={disabled} onChange={() => onSave(list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
            <span className={cx("flex-1", s.done && "text-slate-400 line-through")}>{s.text}</span>
            {!disabled && (
              <button className="text-slate-400 hover:text-rose-600" aria-label="Xóa việc con" onClick={() => onSave(list.filter((_, j) => j !== i))}>
                <Icon name="x" className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onSave([...list, { text: text.trim(), done: false }]);
            setText("");
          }}
        >
          <input className="input h-9" value={text} maxLength={200} placeholder="Thêm việc con…" onChange={(e) => setText(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" icon="plus">
            Thêm
          </Button>
        </form>
      )}
    </div>
  );
}

function Dependencies({ task, allTasks, disabled, onSave }: { task: TaskDto; allTasks: TaskDto[]; disabled: boolean; onSave: (ids: number[]) => void }) {
  const others = allTasks.filter((t) => t.id !== task.id);
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  return (
    <div>
      <p className="label">Phải xong trước</p>
      <ul className="space-y-1">
        {task.dependsOn.map((id) => {
          const t = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              <Icon name={t?.status === "DONE" ? "check" : "clock"} className={cx("size-4", t?.status === "DONE" ? "text-emerald-600" : "text-amber-500")} />
              <span className="flex-1 truncate">{t?.title ?? `Việc #${id}`}</span>
              {!disabled && (
                <button className="text-slate-400 hover:text-rose-600" aria-label="Bỏ phụ thuộc" onClick={() => onSave(task.dependsOn.filter((x) => x !== id))}>
                  <Icon name="x" className="size-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!disabled && others.length > 0 && (
        <Select className="mt-2 h-9" value="" onChange={(e) => e.target.value && onSave([...task.dependsOn, Number(e.target.value)])}>
          <option value="">+ Thêm việc phải xong trước…</option>
          {others
            .filter((t) => !task.dependsOn.includes(t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}

function Comments({ task, members, onPosted }: { task: TaskDto; members: MemberDto[]; onPosted: (n: number) => void }) {
  const toast = useToast();
  const { data, setData, error } = useApi<{ comments: CommentDto[] }>(`/api/tasks/${task.id}/comments`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const m = text.match(/@([A-Za-z0-9_-]*)$/);
  const suggest = m ? members.filter((x) => x.code.toLowerCase().startsWith(m[1].toLowerCase()) || x.name.toLowerCase().includes(m[1].toLowerCase())).slice(0, 5) : [];

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ comments: CommentDto[] }>(`/api/tasks/${task.id}/comments`, { body: { text: text.trim() } });
      setData(r);
      setText("");
      onPosted(r.comments.length);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data?.comments.length ? (
        <p className="text-sm text-slate-500">Chưa có bình luận.</p>
      ) : (
        <ul className="space-y-3">
          {data.comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.author?.name ?? "?"} src={c.author?.avatarUrl} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{c.author?.name ?? "Không rõ"}</span> · {relTime(c.createdAt)}
                </p>
                <p className="text-sm break-words whitespace-pre-wrap text-slate-800">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {task.perms.comment && (
        <div className="relative">
          {suggest.length > 0 && (
            <div className="absolute bottom-full mb-1 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {suggest.map((s) => (
                <button key={s.id} className="block w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => setText(text.replace(/@([A-Za-z0-9_-]*)$/, `@${s.code} `))}>
                  @{s.code} — {s.name}
                </button>
              ))}
            </div>
          )}
          <textarea className="input min-h-20" value={text} maxLength={2000} placeholder="Viết bình luận… gõ @ để nhắc tên (theo mã NV)" onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={send} loading={busy} disabled={!text.trim()}>
              Gửi
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
