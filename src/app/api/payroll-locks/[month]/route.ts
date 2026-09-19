import { z } from "zod";
import { handle, json, parseJson, type RouteCtx } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { unlockMonth } from "@/lib/payroll-lock";

/** Mở khóa tháng đã chốt công (chỉ Quản trị), bắt buộc lý do. */
export const DELETE = handle<{ month: string }>(async (req, ctx: RouteCtx<{ month: string }>) => {
  const u = await requirePerm(req, "payroll.unlock");
  const { month } = await ctx.params;
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().max(300) }));
  return json(await unlockMonth(u, month, reason));
});
