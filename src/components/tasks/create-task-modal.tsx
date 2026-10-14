"use client";
import { useState } from "react";
import { Button, Field, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api } from "@/lib/client/api";
import { addDaysStr, fromLocalInput, todayStr } from "@/lib/client/format";
import {
  RECURRENCE_LABEL,
  RECURRENCES,
  REMINDER_LABEL,
  REMINDERS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type MemberDto,
  type Recurrence,
  type Reminder,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";

/** Chọn người được giao trong danh sách thành viên (`only` = giới hạn người được chọn, vd. Cộng tác chỉ tự nhận). */
export function AssigneePicker({ members, value, onChange, only }: { members: MemberDto[]; value: number[]; onChange: (ids: number[]) => void; only?: number[] }) {
  const list = members.filter((m) => m.active && (!only || only.includes(m.id) || value.includes(m.id)));
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((m) => {
        const on = value.includes(m.id);
        const locked = !!only && !only.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            disabled={locked}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={`rounded-full border px-2.5 py-1 text-sm transition disabled:opacity-50 ${on ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {on ? "✓ " : ""}
            {m.name} <span className="text-xs text-slate-400">{m.code}</span>
          </button>
        );
      })}
      {!list.length && <p className="text-sm text-slate-500">Dự án chưa có thành viên khác.</p>}
    </div>
  );
}

export function CreateTaskModal({
  projectId,
  members,
  meId,
  canAssignOthers,
  defaultStatus = "TODO",
  onClose,
  onCreated,
}: {
  projectId: number;
  members: MemberDto[];
  meId: number;
  canAssignOthers: boolean;
  defaultStatus?: TaskStatus;
  onClose: () => void;
  onCreated: (t: TaskDto) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(`${addDaysStr(todayStr(), 1)}T17:00`);
  const [startDate, setStartDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [reminder, setReminder] = useState<Reminder>("NONE");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [subtasks, setSubtasks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ task: TaskDto }>(`/api/tasks/projects/${projectId}/tasks`, {
        body: {
          title: title.trim(),
          description,
          status: defaultStatus,
          dueAt: fromLocalInput(due),
          startDate: startDate || null,
          priority,
          reminder,
          recurrence,
          assigneeIds,
          subtasks: subtasks
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      toast.success("Đã tạo việc");
      onCreated(r.task);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Việc mới — ${TASK_STATUS_LABEL[defaultStatus]}`}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || !due}>
            Tạo việc
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tiêu đề">{(id) => <input id={id} className="input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hạn hoàn thành">{(id) => <input id={id} type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label="Ngày bắt đầu (tùy chọn)">{(id) => <input id={id} type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Ưu tiên">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Nhắc hạn (chuông + Zalo riêng)">
            {(id) => (
              <Select id={id} value={reminder} onChange={(e) => setReminder(e.target.value as Reminder)}>
                {REMINDERS.map((r) => (
                  <option key={r} value={r}>
                    {REMINDER_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Lặp lại" hint={recurrence !== "NONE" ? "Mỗi kỳ hệ thống tạo một bản mới lúc 00:00, hạn cùng giờ với việc này" : undefined}>
            {(id) => (
              <Select id={id} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                {RECURRENCES.map((r) => (
                  <option key={r} value={r}>
                    {RECURRENCE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div>
          <p className="label">Giao cho</p>
          <AssigneePicker members={members} value={assigneeIds} onChange={setAssigneeIds} only={canAssignOthers ? undefined : [meId]} />
        </div>
        <Field label="Mô tả">{(id) => <textarea id={id} className="input min-h-20" value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Việc con (mỗi dòng một việc)" hint="Phải xong hết việc con mới chuyển được sang Hoàn thành">
          {(id) => <textarea id={id} className="input min-h-16" value={subtasks} onChange={(e) => setSubtasks(e.target.value)} />}
        </Field>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
