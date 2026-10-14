"use client";
import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { useProjectTasks } from "@/components/tasks/use-project-tasks";
import { addDaysStr, todayStr } from "@/lib/client/format";

/** Cửa sổ Gantt = 92 ngày (giới hạn một lần tải của API), mặc định bắt đầu 2 tuần trước hôm nay. */
const WINDOW_DAYS = 92;

// Gantt chỉ chạy ở trình duyệt (đo kéo chuột / chạm) — tách chunk riêng.
const GanttChart = dynamic(() => import("@/components/tasks/gantt-chart"), { ssr: false, loading: () => <Loading label="Đang vẽ Gantt…" /> });

export default function ProjectGanttPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gantt />
    </Suspense>
  );
}

function Gantt() {
  const [from, setFrom] = useState(() => addDaysStr(todayStr(), -14));
  const to = addDaysStr(from, WINDOW_DAYS - 1);
  const { proj, data, error, reload, tasks, unscheduled, unscheduledTotal, patchTask, setOpen, drawer } = useProjectTasks(`gantt=1&from=${from}&to=${to}`);
  if (proj?.project.deletedAt) return <ErrorBox message="Dự án đã bị xóa — vào tab Cài đặt để khôi phục (Chủ dự án / Nhân sự)." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!proj) return <Loading />;
  if (!data) return <Loading label="Đang tải việc…" />;
  return (
    <div>
      <GanttChart
        from={from}
        to={to}
        tasks={tasks}
        unscheduled={unscheduled}
        unscheduledTotal={unscheduledTotal}
        onWindow={setFrom}
        onOpen={(t) => setOpen(t.id)}
        onMove={(t, change) => void patchTask(t, change)}
      />
      {drawer}
    </div>
  );
}
