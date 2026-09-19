import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseQuery } from "@/lib/api";
import { employeeScopeWhere, requireUser } from "@/lib/auth";
import { dateStr, optId } from "@/lib/validators";
import { summarizeRange } from "@/lib/attendance-service";
import { toDayRow } from "@/lib/day-rows";
import { todayVN } from "@/lib/attendance";
import { FACE_MODEL_VERSION } from "@/lib/roles";

const query = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  departmentId: optId,
  employeeId: optId,
  flag: z.enum(["all", "late", "early", "absent", "outOfShift", "manual", "missingOut", "leave"]).default("all"),
});

/** Bảng log theo ngày: mỗi (nhân viên, ngày) một dòng kèm các log, cờ bất thường. */
export const GET = handle(async (req) => {
  const u = await requireUser(req, ["ADMIN", "MANAGER"]);
  const q = parseQuery(req, query);
  const from = q.from ?? todayVN();
  const to = q.to ?? from;
  if (to < from) throw badRequest("Khoảng ngày không hợp lệ");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 31) throw badRequest("Tối đa 31 ngày mỗi lần xem");
  const emps = await prisma.employee.findMany({
    where: { ...employeeScopeWhere(u, q.departmentId), active: true, ...(q.employeeId ? { id: q.employeeId } : {}) },
    orderBy: [{ departmentId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      department: { select: { name: true } },
      faceTemplates: { where: { modelVersion: FACE_MODEL_VERSION }, select: { id: true }, take: 1 },
    },
  });
  const { summaries } = await summarizeRange(emps.map((e) => e.id), from, to);
  const empById = new Map(emps.map((e) => [e.id, e]));
  const rows = [];
  for (const [k, s] of summaries) {
    const e = empById.get(Number(k.split("|")[0]))!;
    const row = toDayRow(s);
    const keep =
      q.flag === "all"
        ? row.shift || row.logs.length > 0
        : q.flag === "late"
          ? row.isLate
          : q.flag === "early"
            ? row.isEarly
            : q.flag === "absent"
              ? row.status === "ABSENT"
              : q.flag === "leave"
                ? row.status === "ON_LEAVE"
                : q.flag === "outOfShift"
                  ? row.logs.some((l) => l.outOfShift)
                  : q.flag === "manual"
                    ? row.hasManual
                    : row.missingOut;
    if (!keep) continue;
    rows.push({
      employee: { id: e.id, code: e.code, name: e.name, department: e.department.name, enrolled: e.faceTemplates.length > 0 },
      ...row,
    });
  }
  rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  return json({ from, to, rows });
});
