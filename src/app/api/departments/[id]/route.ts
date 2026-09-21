import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { can, requirePerm } from "@/lib/permissions";
import { assertDept } from "@/lib/auth";
import { assertCanModify } from "@/lib/employee-guards";
import { announce } from "@/lib/announce";
import { parseIds } from "@/lib/info-links";
import { APPROVAL_MODES, APPROVAL_MODE_LABEL } from "@/lib/roles";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  managerId: z.number().int().positive().nullable().optional(),
  // Không .default(): PATCH chỉ đổi trường được gửi.
  approvalMode: z.enum(APPROVAL_MODES).optional(),
});

/** Đổi tên, gán quản lý, đổi cách duyệt đơn của phòng ban. Người được gán tự lên vai trò MANAGER nếu đang là EMPLOYEE. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, schema);
  const d = await prisma.department.findUnique({ where: { id } });
  if (!d) throw notFound();
  assertDept(u, id);
  if (body.name && body.name !== d.name && (await prisma.department.findUnique({ where: { name: body.name } }))) throw badRequest("Tên phòng ban đã tồn tại");
  // Cách duyệt đơn quyết định Nhân sự có được kiểm soát hay không: Quản lý không tự đổi được kể cả khi được cấp org.manage
  // (mặc định chỉ Quản trị có org.manage; Nhân sự đổi được nếu Quản trị cấp quyền "Tổ chức").
  if (body.approvalMode !== undefined && u.role !== "ADMIN" && u.role !== "HR") throw forbidden("Quản lý không được đổi cách duyệt đơn của phòng");
  let promoted: { id: number; code: string; name: string } | null = null;
  if (body.managerId) {
    const m = await prisma.employee.findUnique({ where: { id: body.managerId } });
    if (!m || !m.active) throw badRequest("Quản lý không hợp lệ");
    // Chống tự mở rộng phạm vi: không tự gán mình làm quản lý (trừ Quản trị); đổi vai trò đi qua luật chống leo thang.
    if (m.id === u.id && u.role !== "ADMIN") throw forbidden("Không thể tự gán mình làm quản lý phòng ban");
    assertDept(u, m.departmentId);
    if (m.role === "EMPLOYEE") {
      await assertCanModify(u, m, { role: "MANAGER" });
      promoted = m;
    } else if (m.role !== "MANAGER" && !(await can(u, "roles.assignPrivileged"))) {
      throw forbidden("Chỉ Quản trị được gán Nhân sự / Quản trị làm quản lý phòng");
    }
  }
  // Nâng vai trò và cập nhật phòng trong cùng giao dịch: cập nhật phòng lỗi thì không để lại nhân viên đã bị nâng thành Quản lý.
  await prisma.$transaction([
    ...(promoted ? [prisma.employee.update({ where: { id: promoted.id }, data: { role: "MANAGER" } })] : []),
    prisma.department.update({ where: { id }, data: body }),
  ]);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "Department", entityId: id, detail: body });
  if (body.managerId !== undefined) {
    const m = body.managerId ? await prisma.employee.findUnique({ where: { id: body.managerId }, select: { code: true, name: true } }) : null;
    await announce(u, `đã ${m ? `gán ${m.code} — ${m.name} làm quản lý` : "gỡ quản lý"} phòng ${d.name}`, {
      key: `dept-manager:${id}:${Date.now()}`,
      detail: promoted ? "Tự động nâng vai trò Nhân viên → Quản lý" : undefined,
    });
  }
  if (body.approvalMode !== undefined && body.approvalMode !== d.approvalMode) {
    // Đơn đang ở bước 1 xong (MANAGER_APPROVED) vẫn chờ Nhân sự như cũ; luật mới áp cho các lần duyệt tiếp theo.
    await announce(u, `đã đổi cách duyệt đơn của phòng ${d.name}`, {
      key: `dept-approval:${id}:${Date.now()}`,
      detail: `${APPROVAL_MODE_LABEL[d.approvalMode as keyof typeof APPROVAL_MODE_LABEL] ?? d.approvalMode} → ${APPROVAL_MODE_LABEL[body.approvalMode]}`,
    });
  }
  return json({ ok: true });
});

/**
 * Xóa phòng ban: chỉ khi phòng trống hoàn toàn. Nhiều bảng lịch sử (RosterWeek, ScheduleAssignment, LockedDay) tham chiếu phòng
 * mà không có khóa ngoại nên phải tự kiểm tra — xóa bừa sẽ làm bảng công / chốt công mất tên phòng. Nhân viên đã nghỉ vẫn giữ
 * departmentId (bắt buộc) => phòng đã từng có người thì không xóa được, chỉ đổi tên.
 */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "org.manage");
  const id = await idParam(ctx);
  const d = await prisma.department.findUnique({ where: { id } });
  if (!d) throw notFound();
  assertDept(u, id);
  const [emps, weeks, assignments, locked] = await Promise.all([
    prisma.employee.count({ where: { departmentId: id } }),
    prisma.rosterWeek.count({ where: { departmentId: id } }),
    prisma.scheduleAssignment.count({ where: { departmentId: id } }),
    prisma.lockedDay.count({ where: { departmentId: id } }),
  ]);
  const reasons = [
    emps > 0 && `${emps} nhân viên (kể cả đã nghỉ việc)`,
    weeks > 0 && `${weeks} tuần đã đăng ký ca`,
    assignments > 0 && `${assignments} bản ghi lịch sử phân công`,
    locked > 0 && `${locked} ngày đã chốt công`,
  ].filter(Boolean);
  if (reasons.length) throw badRequest(`Không thể xóa phòng "${d.name}": còn ${reasons.join(", ")}. Hãy chuyển nhân viên sang phòng khác hoặc đổi tên phòng thay vì xóa.`);
  // Liên kết "Thông tin" đang giới hạn theo phòng này: bỏ phòng khỏi danh sách; nếu thành rỗng (= toàn công ty) thì tạm ẩn để không lộ ngoài ý muốn.
  const links = (await prisma.infoLink.findMany({ where: { visibleDeptIds: { contains: `${id}` } } })).filter((l) => parseIds(l.visibleDeptIds).includes(id));
  const linkUpdates = links.map((l) => {
    const rest = parseIds(l.visibleDeptIds).filter((x) => x !== id);
    return prisma.infoLink.update({ where: { id: l.id }, data: { visibleDeptIds: JSON.stringify(rest), ...(rest.length === 0 && { active: false }) } });
  });
  await prisma.$transaction([prisma.departmentShiftWeight.deleteMany({ where: { departmentId: id } }), ...linkUpdates, prisma.department.delete({ where: { id } })]);
  await audit({ actorId: u.id, action: "SETTINGS_UPDATE", entity: "Department", entityId: id, detail: { deleted: true, name: d.name, hiddenLinks: links.filter((l) => parseIds(l.visibleDeptIds).length === 1).map((l) => l.id) } });
  await announce(u, `đã xóa phòng ban "${d.name}" (phòng trống)`, { key: `dept-delete:${id}` });
  return json({ ok: true });
});
