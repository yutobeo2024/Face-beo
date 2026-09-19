import { prisma } from "@/lib/db";
import { badRequest, handle, json, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { shiftWeightsSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { announce, onceKey } from "@/lib/announce";
import { assertDept, deptScope } from "@/lib/auth";

/** Hệ số công riêng theo phòng ban (ghi đè hệ số chung của ca). Quản lý được cấp `org.manage` chỉ thấy phòng mình. */
export const GET = handle(async (req) => {
  const u = await requirePerm(req, "org.manage");
  const scope = deptScope(u);
  const weights = await prisma.departmentShiftWeight.findMany({
    where: scope ? { departmentId: { in: scope } } : {},
    orderBy: [{ departmentId: "asc" }, { shiftId: "asc" }],
  });
  return json({ weights });
});

/** Đặt / xóa (workDayValue = null) hệ số riêng. Áp dụng cho các tháng chưa chốt công; có nhật ký và tin nhóm Zalo. */
export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "org.manage");
  const { weights } = await parseJson(req, shiftWeightsSchema);
  const deptIds = [...new Set(weights.map((w) => w.departmentId))];
  for (const d of deptIds) assertDept(u, d);
  const shiftIds = [...new Set(weights.map((w) => w.shiftId))];
  const [depts, shifts, before] = await Promise.all([
    prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
    prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, name: true, workDayValue: true } }),
    prisma.departmentShiftWeight.findMany({ where: { departmentId: { in: deptIds }, shiftId: { in: shiftIds } } }),
  ]);
  if (depts.length !== deptIds.length) throw badRequest("Phòng ban không tồn tại");
  if (shifts.length !== shiftIds.length) throw badRequest("Ca không tồn tại");
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const shiftOf = new Map(shifts.map((s) => [s.id, s]));
  const old = new Map(before.map((w) => [`${w.departmentId}|${w.shiftId}`, w.workDayValue]));

  await prisma.$transaction(
    weights.map((w) =>
      w.workDayValue == null
        ? prisma.departmentShiftWeight.deleteMany({ where: { departmentId: w.departmentId, shiftId: w.shiftId } })
        : prisma.departmentShiftWeight.upsert({
            where: { departmentId_shiftId: { departmentId: w.departmentId, shiftId: w.shiftId } },
            create: { departmentId: w.departmentId, shiftId: w.shiftId, workDayValue: w.workDayValue },
            update: { workDayValue: w.workDayValue },
          }),
    ),
  );

  const lines: string[] = [];
  for (const w of weights) {
    const sh = shiftOf.get(w.shiftId)!;
    const prev = old.get(`${w.departmentId}|${w.shiftId}`) ?? null;
    if (prev === w.workDayValue) continue;
    const fmt = (v: number | null) => (v == null ? `theo ca (${sh.workDayValue})` : String(v));
    lines.push(`• ${deptName.get(w.departmentId)} — ${sh.name}: ${fmt(prev)} → ${fmt(w.workDayValue)}`);
  }
  if (lines.length) {
    await audit({ actorId: u.id, action: "SHIFT_WEIGHT_UPDATE", entity: "DepartmentShiftWeight", detail: { weights } });
    await announce(u, `đã đổi hệ số công theo phòng (${lines.length} mục)`, {
      key: onceKey("shift-weights", u.id),
      detail: `${lines.join("\n")}\nÁp dụng cho các tháng chưa chốt công.`,
    });
  }
  return json({ changed: lines.length });
});
