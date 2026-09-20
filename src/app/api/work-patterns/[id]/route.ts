import { prisma } from "@/lib/db";
import { applyScheduleChangeFromToday, ensureBaseline } from "@/lib/schedule-assignments";

const DAY_KEYS = ["monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId"] as const;
import { badRequest, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { requirePerm } from "@/lib/permissions";
import { assertShiftsExist, patternSchema } from "@/lib/work-patterns";
import { audit } from "@/lib/audit";
import { announce, onceKey } from "@/lib/announce";

/** Sửa mẫu tuần: ảnh hưởng mọi nhân viên cố định đang dùng mẫu — có nhật ký và tin nhóm Zalo. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, patternSchema.partial());
  const before = await prisma.workPattern.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!before) throw notFound();
  await assertShiftsExist(body);
  if (body.name && body.name !== before.name && (await prisma.workPattern.findUnique({ where: { name: body.name } }))) throw badRequest("Tên mẫu tuần đã tồn tại");
  const users = await prisma.employee.findMany({ where: { workPatternId: id }, select: { id: true } });
  await ensureBaseline(users.map((x) => x.id));
  const after = await prisma.workPattern.update({ where: { id }, data: body });
  // Đổi ca theo thứ: áp dụng từ hôm nay cho người đang dùng mẫu (công đã qua giữ nguyên).
  const dayChanged = DAY_KEYS.some((k) => body[k] !== undefined && body[k] !== before[k]);
  if (dayChanged) {
    await applyScheduleChangeFromToday(users.map((x) => x.id));
  }
  await audit({ actorId: u.id, action: "PATTERN_UPDATE", entity: "WorkPattern", entityId: id, detail: { before, after } });
  await announce(u, `đã sửa mẫu tuần làm việc "${after.name}"`, { key: onceKey("pattern-update", id), detail: `Áp dụng cho ${before._count.employees} nhân viên${dayChanged ? ", có hiệu lực từ hôm nay" : ""}` });
  return json({ pattern: after });
});

/**
 * Xóa mẫu tuần: chặn khi còn nhân viên ĐANG LÀM dùng mẫu (khớp con số hiển thị trên UI).
 * Nhân viên đã nghỉ việc còn trỏ tới mẫu thì gỡ liên kết — lịch sử công của họ đã nằm trong ScheduleAssignment (snapshot), không mất.
 */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const p = await prisma.workPattern.findUnique({ where: { id }, include: { _count: { select: { employees: { where: { active: true } } } } } });
  if (!p) throw notFound();
  if (p._count.employees > 0) throw badRequest(`Mẫu đang được ${p._count.employees} nhân viên sử dụng, không thể xóa. Đổi mẫu cho họ trong hồ sơ trước.`);
  const [detached] = await prisma.$transaction([
    prisma.employee.updateMany({ where: { workPatternId: id }, data: { workPatternId: null } }),
    prisma.workPattern.delete({ where: { id } }),
  ]);
  await audit({ actorId: u.id, action: "PATTERN_UPDATE", entity: "WorkPattern", entityId: id, detail: { deleted: p.name, detachedInactive: detached.count } });
  await announce(u, `đã xóa mẫu tuần làm việc "${p.name}"`, { key: `pattern-delete:${id}` });
  return json({ ok: true });
});
