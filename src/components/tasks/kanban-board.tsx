"use client";
/**
 * Bảng Kanban (v1.23.0). Nạp bằng next/dynamic từ trang dự án để @dnd-kit/core không vào bundle trang khác.
 * Kéo bằng chuột (PointerSensor) hoặc chạm giữ 150 ms (TouchSensor); điện thoại có thêm ô chọn trạng thái trên thẻ.
 */
import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Avatar, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { TASK_STATUS_LABEL, TASK_STATUSES, type TaskDto, type TaskStatus } from "@/lib/tasks/types";
import { DueText, PriorityBadge } from "./task-badges";

const COLUMN_TINT: Record<TaskStatus, string> = { TODO: "bg-slate-400", DOING: "bg-brand-500", REVIEW: "bg-violet-500", DONE: "bg-emerald-500" };

export type KanbanProps = {
  tasks: TaskDto[];
  canCreate: boolean;
  onStatus: (t: TaskDto, s: TaskStatus) => void;
  onOpen: (t: TaskDto) => void;
  onCreate: (s: TaskStatus) => void;
};

export default function KanbanBoard({ tasks, canCreate, onStatus, onOpen, onCreate }: KanbanProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }));
  const [dragging, setDragging] = useState<TaskDto | null>(null);
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const t = tasks.find((x) => x.id === Number(e.active.id));
    const to = e.over?.id as TaskStatus | undefined;
    if (t && to && to !== t.status) onStatus(t, to);
  };

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(tasks.find((x) => x.id === Number(e.active.id)) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {TASK_STATUSES.map((s) => (
          <Column key={s} status={s} count={byStatus(s).length} canCreate={canCreate} onCreate={() => onCreate(s)}>
            {byStatus(s).map((t) => (
              <DraggableCard key={t.id} task={t} onOpen={() => onOpen(t)} onStatus={(to) => onStatus(t, to)} hidden={dragging?.id === t.id} />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay>{dragging ? <Card task={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, count, canCreate, onCreate, children }: { status: TaskStatus; count: number; canCreate: boolean; onCreate: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={cx("flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-2xl bg-slate-100/80 p-2 transition sm:w-72 lg:w-auto lg:max-w-none", isOver && "ring-2 ring-brand-400")}>
      <header className="flex items-center justify-between px-2 py-1.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span className={cx("size-2 rounded-full", COLUMN_TINT[status])} />
          {TASK_STATUS_LABEL[status]} <span className="font-normal text-slate-400">{count}</span>
        </h2>
        {canCreate && (
          <button onClick={onCreate} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label={`Thêm việc vào ${TASK_STATUS_LABEL[status]}`}>
            <Icon name="plus" className="size-4" />
          </button>
        )}
      </header>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}

function DraggableCard({ task, onOpen, onStatus, hidden }: { task: TaskDto; onOpen: () => void; onStatus: (s: TaskStatus) => void; hidden: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: task.id, disabled: !task.perms.edit });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cx("touch-manipulation", hidden && "opacity-30")}>
      <Card task={task} onOpen={onOpen} onStatus={onStatus} />
    </div>
  );
}

function Card({ task, onOpen, onStatus, overlay }: { task: TaskDto; onOpen?: () => void; onStatus?: (s: TaskStatus) => void; overlay?: boolean }) {
  const done = task.subtasks.filter((s) => s.done).length;
  return (
    <article className={cx("card cursor-pointer p-3 text-left transition hover:border-slate-300", overlay && "rotate-2 shadow-[var(--shadow-pop)]")} onClick={onOpen}>
      <p className={cx("text-sm font-medium text-slate-800", task.status === "DONE" && "text-slate-400 line-through")}>{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} compact />
        <DueText dueAt={task.dueAt} status={task.status} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {task.assignees.slice(0, 4).map((a) => (
            <Avatar key={a.id} name={a.name} src={a.avatarUrl} className="size-6 ring-2 ring-white" />
          ))}
          {task.assignees.length > 4 && <span className="pl-2 text-xs text-slate-500">+{task.assignees.length - 4}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {task.recurrence !== "NONE" && <Icon name="refresh" className="size-3.5" />}
          {task.subtasks.length > 0 && (
            <span className={cx(done === task.subtasks.length && "text-emerald-600")}>
              ☑ {done}/{task.subtasks.length}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Icon name="chat" className="size-3.5" />
              {task.commentCount}
            </span>
          )}
        </div>
      </div>
      {/* Điện thoại: kéo giữa các cột khó ⇒ có thêm ô chọn trạng thái. */}
      {onStatus && task.perms.edit && (
        <select
          className="input mt-2 h-8 py-0 text-xs md:hidden"
          value={task.status}
          aria-label="Đổi trạng thái"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onChange={(e) => onStatus(e.target.value as TaskStatus)}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}
