/** Lịch chạy node-cron trong tiến trình server (PRD mục 8). Khởi động từ instrumentation.ts. */
import cron from "node-cron";
import { runJob, type JobName } from "./jobs";
import { TZ } from "./attendance";

const SCHEDULE: Record<JobName, string> = {
  "absence-check": "*/5 * * * *",
  "missing-checkout": "*/30 * * * *",
  "zalo-token-refresh": "0 */6 * * *",
  "snapshot-cleanup": "0 2 * * *",
  "db-backup": "0 3 * * *",
};

const g = globalThis as unknown as { __cronStarted?: boolean; __jobRunning?: Set<string> };

export function startCron() {
  if (g.__cronStarted) return;
  g.__cronStarted = true;
  const running = (g.__jobRunning ??= new Set());
  for (const [name, expr] of Object.entries(SCHEDULE) as [JobName, string][]) {
    cron.schedule(
      expr,
      async () => {
        if (running.has(name)) return; // không chồng lượt
        running.add(name);
        try {
          const r = await runJob(name);
          console.log(`[cron] ${name}`, JSON.stringify(r));
        } catch (e) {
          console.error(`[cron] ${name} lỗi:`, (e as Error).message);
        } finally {
          running.delete(name);
        }
      },
      { timezone: TZ },
    );
  }
  console.log("[cron] đã lên lịch:", Object.keys(SCHEDULE).join(", "));
}
