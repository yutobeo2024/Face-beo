"use client";
import { Suspense, useState } from "react";
import { ErrorBox, Loading } from "@/components/ui";
import { CalendarView, calendarRange, type CalMode } from "@/components/tasks/calendar-view";
import { useProjectTasks } from "@/components/tasks/use-project-tasks";
import { todayStr } from "@/lib/client/format";

export default function ProjectCalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Calendar />
    </Suspense>
  );
}

function Calendar() {
  const [mode, setMode] = useState<CalMode>("month");
  const [anchor, setAnchor] = useState(todayStr());
  const { from, to } = calendarRange(mode, anchor);
  const { proj, data, error, reload, tasks, setOpen, drawer } = useProjectTasks(`from=${from}&to=${to}`);
  if (proj?.project.deletedAt) return <ErrorBox message="Dự án đã bị xóa — vào tab Cài đặt để khôi phục (Chủ dự án / Nhân sự)." />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!proj) return <Loading />;
  return (
    <div>
      <CalendarView mode={mode} anchor={anchor} tasks={data ? tasks : []} onMode={setMode} onAnchor={setAnchor} onOpen={(t) => setOpen(t.id)} />
      {!data && <Loading />}
      {drawer}
    </div>
  );
}
