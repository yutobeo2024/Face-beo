import { z } from "zod";
import { handle, json, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { dateStr, idNum } from "@/lib/validators";
import { registerWeeks } from "@/lib/roster";

/** Đăng ký (khóa) ca tuần cho một hoặc nhiều phòng ban. */
export const POST = handle(async (req) => {
  const u = await requirePerm(req, "roster.edit");
  const body = await parseJson(req, z.object({ week: dateStr, departmentIds: z.array(idNum).min(1).max(50) }));
  return json(await registerWeeks(u, body.departmentIds, body.week));
});
