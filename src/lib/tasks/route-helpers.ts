/** Tiện ích chung cho route /api/tasks/*. */
import type { NextRequest } from "next/server";
import { badRequest, type RouteCtx } from "../api";
import { requirePerm } from "../permissions";

/** Có MỘT trong ba quyền Công việc là vào được phân hệ (tạo dự án / quản lý tất cả ngầm gồm quyền dùng). */
export const TASK_CAPS = ["tasks.use", "tasks.createProject", "tasks.manageAll"] as const;
export const requireTasks = (req: NextRequest) => requirePerm(req, [...TASK_CAPS]);

export async function intParam<K extends string>(ctx: RouteCtx<Record<K, string>>, key: K): Promise<number> {
  const v = Number((await ctx.params)[key]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`${key} không hợp lệ`);
  return v;
}
