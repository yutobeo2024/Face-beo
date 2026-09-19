import { timingSafeEqual } from "node:crypto";
import { handle, HttpError, json, notFound } from "@/lib/api";
import { env } from "@/lib/env";
import { JOBS, runJob, type JobName } from "@/lib/jobs";

/** POST /api/cron/{job} với header x-cron-secret — dùng cho cron ngoài hoặc test tay. */
export const POST = handle<{ job: string }>(async (req, ctx) => {
  const got = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(env.cronSecret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "Sai CRON_SECRET");
  const { job } = await ctx.params;
  if (!(JOBS as readonly string[]).includes(job)) throw notFound("Job không tồn tại");
  const started = Date.now();
  const result = await runJob(job as JobName);
  return json({ job, ms: Date.now() - started, result });
});
