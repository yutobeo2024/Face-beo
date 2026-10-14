"use client";
/** Dashboard một dự án (v1.24.0): số liệu từ GET /api/tasks/projects/[id]/stats — đã lọc theo quyền xem của người dùng. */
import { useState } from "react";
import { Card, ErrorBox, Loading, Segmented, StatCard } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { addDaysStr, todayStr } from "@/lib/client/format";
import type { ProjectStats } from "@/lib/tasks/task-stats";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/tasks/types";
import { BarChart } from "./charts/bar-chart";
import { BurnupChart } from "./charts/burnup-chart";
import { DonutChart } from "./charts/donut-chart";

const PRIORITY_BAR: Record<string, string> = { LOW: "bg-slate-300", MEDIUM: "bg-sky-300", HIGH: "bg-amber-300", URGENT: "bg-rose-300" };

const hoursText = (h: number | null) => (h === null ? "—" : h < 24 ? `${h} giờ` : `${Math.round((h / 24) * 10) / 10} ngày`);

export function ProjectDashboard({ projectId, seeAll }: { projectId: number; seeAll: boolean }) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const to = todayStr();
  const from = addDaysStr(to, -(Number(days) - 1));
  const { data, error, reload } = useApi<{ stats: ProjectStats; truncated?: boolean }>(`/api/tasks/projects/${projectId}/stats?from=${from}&to=${to}`);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.stats;
  // Đổi khoảng: dữ liệu cũ còn hiện trong lúc tải — nhãn lấy theo khoảng của CHÍNH số liệu đang hiện.
  const shownDays = s.burnup.length;
  const stale = s.from !== from || s.to !== to;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: "7", label: "7 ngày" },
            { value: "30", label: "30 ngày" },
            { value: "90", label: "90 ngày" },
          ]}
        />
        {stale && <p className="text-xs text-slate-400">Đang tải…</p>}
        {!seeAll && <p className="text-xs text-slate-500">Số liệu chỉ gồm việc bạn được giao hoặc tự tạo.</p>}
        {data.truncated && <p className="text-xs text-amber-700">Dự án rất lớn: số liệu tính trên 5.000 việc mới nhất.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tổng việc" value={s.total} tone="brand" />
        <StatCard label="Đã xong" value={s.done} tone="ontime" hint={s.total ? `${Math.round((s.done / s.total) * 100)}%` : undefined} />
        <StatCard label="Quá hạn" value={s.overdue} tone="absent" hint="chưa xong mà đã qua hạn" />
        <StatCard label="Xong trung bình sau" value={hoursText(s.avgCompletionHours)} hint={`${s.completedInRange} việc xong trong ${shownDays} ngày`} />
      </div>
      <Card className="p-4">
        <p className="mb-2 font-semibold text-slate-800">Tiến độ {shownDays} ngày</p>
        <BurnupChart data={s.burnup} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="mb-3 font-semibold text-slate-800">Theo trạng thái</p>
          <DonutChart
            center="việc"
            items={[
              { label: TASK_STATUS_LABEL.TODO, value: s.todo, stroke: "stroke-slate-400", dot: "bg-slate-400" },
              { label: TASK_STATUS_LABEL.DOING, value: s.doing, stroke: "stroke-teal-600", dot: "bg-teal-600" },
              { label: TASK_STATUS_LABEL.REVIEW, value: s.review, stroke: "stroke-violet-500", dot: "bg-violet-500" },
              { label: TASK_STATUS_LABEL.DONE, value: s.done, stroke: "stroke-emerald-500", dot: "bg-emerald-500" },
            ]}
          />
        </Card>
        <Card className="p-4">
          <p className="mb-3 font-semibold text-slate-800">Theo ưu tiên</p>
          <BarChart
            partLabel="xong"
            items={[...TASK_PRIORITIES]
              .reverse()
              .map((p) => ({ key: p, label: TASK_PRIORITY_LABEL[p], value: s.byPriority[p].total, part: s.byPriority[p].total - s.byPriority[p].open, hint: `${s.byPriority[p].open} còn mở`, bar: PRIORITY_BAR[p] }))}
          />
        </Card>
        <Card className="p-4">
          <p className="mb-3 font-semibold text-slate-800">Theo người làm</p>
          <BarChart partLabel="xong" items={s.byAssignee.slice(0, 12).map((a) => ({ key: a.id, label: a.name, value: a.total, part: a.done, hint: a.overdue ? `${a.overdue} quá hạn` : undefined }))} />
        </Card>
      </div>
    </div>
  );
}
