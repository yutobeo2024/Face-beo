"use client";
import { Badge, cx, type Tone } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDateTime } from "@/lib/client/format";
import { PROJECT_COLORS, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type ProjectColor, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";

export const STATUS_TONE: Record<TaskStatus, Tone> = { TODO: "neutral", DOING: "brand", REVIEW: "violet", DONE: "ontime" };
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { LOW: "neutral", MEDIUM: "leave", HIGH: "late", URGENT: "absent" };

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {TASK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority, compact }: { priority: TaskPriority; compact?: boolean }) {
  if (compact && priority === "MEDIUM") return null;
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      <Icon name="flag" className="size-3" /> {TASK_PRIORITY_LABEL[priority]}
    </Badge>
  );
}

/** Hạn: đỏ khi quá hạn (chưa xong), cam khi trong 24 giờ tới. */
export function DueText({ dueAt, status, className }: { dueAt: string; status: TaskStatus; className?: string }) {
  const ms = new Date(dueAt).getTime() - Date.now();
  const tone = status === "DONE" ? "text-slate-400" : ms < 0 ? "font-semibold text-rose-600" : ms < 86_400_000 ? "font-semibold text-amber-600" : "text-slate-500";
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs tabular-nums", tone, className)}>
      <Icon name="clock" className="size-3.5" />
      {fmtDateTime(dueAt)}
      {status !== "DONE" && ms < 0 && " · quá hạn"}
    </span>
  );
}

export function ProjectDot({ color, className }: { color: ProjectColor; className?: string }) {
  return <span className={cx("inline-block size-2.5 shrink-0 rounded-full", PROJECT_COLORS[color]?.dot ?? "bg-slate-400", className)} />;
}
