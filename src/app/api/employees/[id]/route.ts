import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { deleteCredentialDir } from "@/lib/credential-files";
import { canViewSnapshots, clearFaceAvatar } from "@/lib/face-avatar";
import { clearProfilePhoto, displayAvatarUrl } from "@/lib/profile-photo";
import { keepTrackedUnlessAdmin } from "@/lib/attendance-scope";
import { ensurePatternFor } from "@/lib/work-patterns";
import { randomTempPassword } from "@/lib/temp-password";
import { todayVN } from "@/lib/attendance";
import { applyScheduleChangeFromToday, ensureBaseline } from "@/lib/schedule-assignments";
import { badRequest, forbidden, handle, idParam, json, notFound, parseJson } from "@/lib/api";
import { canViewEmployee, requireUser } from "@/lib/auth";
import { employeeUpdateSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { can, requirePerm } from "@/lib/permissions";
import { assertCanModify } from "@/lib/employee-guards";
import { assertCatalogIds } from "@/lib/catalogs";
import { PERSONAL_KEYS, assertUniqueEmployee, canSeePersonal, maskPersonal, redactPersonal } from "@/lib/employees";
import { announce, onceKey } from "@/lib/announce";
import { ROLE_LABEL, type Role } from "@/lib/roles";

export const GET = handle<{ id: string }>(async (req, ctx) => {
  const u = await requireUser(req);
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      nationalId: true,
      dateOfBirth: true,
      gender: true,
      address: true,
      role: true,
      active: true,
      departmentId: true,
      department: { select: { name: true } },
      defaultShiftId: true,
      zaloLinkedAt: true,
      biometricConsentAt: true,
      chatbotEnabled: true,
      faceTemplates: { select: { modelVersion: true, createdAt: true } },
      faceAvatarKey: true,
      faceAvatarAt: true,
      photoKey: true,
      photoAt: true,
    },
  });
  if (!e) throw notFound();
  if (!canViewEmployee(u, e)) throw forbidden();
  const { faceTemplates, faceAvatarKey, faceAvatarAt, photoKey, photoAt, ...all } = e;
  const rest = maskPersonal(all, u);
  const avatarUrl = displayAvatarUrl(u, { id: e.id, departmentId: e.departmentId, faceAvatarKey, faceAvatarAt, photoKey, photoAt }, await canViewSnapshots(u));
  return json({
    employee: {
      ...rest,
      faceCount: faceTemplates.filter((t) => t.modelVersion === FACE_MODEL_VERSION).length,
      faceEnrolledAt: faceTemplates[0]?.createdAt ?? null,
      avatarUrl,
      hasPhoto: !!photoKey,
    },
  });
});

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "employees.manage");
  const id = await idParam(ctx);
  const body = await parseJson(req, employeeUpdateSchema);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound();
  await assertCanModify(u, e, { role: body.role, active: body.active, departmentId: body.departmentId });
  await assertUniqueEmployee({ phone: body.phone !== e.phone ? body.phone : undefined, nationalId: body.nationalId !== e.nationalId ? body.nationalId : undefined }, id);
  // Không chấm công = không bị cảnh báo trễ / vắng: chỉ Quản trị đặt được (người khác có thể tự "thoát" chấm công cho mình / phòng mình).
  if (body.attendanceExempt !== undefined && body.attendanceExempt !== e.attendanceExempt && u.role !== "ADMIN") {
    throw forbidden("Chỉ Quản trị được đổi chế độ chấm công của nhân viên");
  }
  if (body.chatbotEnabled !== undefined && body.chatbotEnabled !== e.chatbotEnabled && !(await can(u, "chatbot.grant"))) {
    throw forbidden("Bạn không có quyền cấp Chat bot cho nhân viên");
  }
  const { resetPassword, unlinkZalo, ...fields } = body;
  // Không phải Nhân sự / Quản trị (vd. Quản lý được cấp quyền quản lý nhân viên): bỏ qua trường cá nhân của người khác — form của họ
  // không có các ô này, không để giá trị rỗng xóa mất dữ liệu.
  if (!canSeePersonal(u) && id !== u.id) for (const k of PERSONAL_KEYS) delete (fields as Record<string, unknown>)[k];
  const data: Record<string, unknown> = { ...fields };
  // Ngày nghỉ việc: sau ngày này không còn lịch làm (không tính vắng); kích hoạt lại => xóa.
  if (fields.active === false && e.active) {
    data.leftAt = new Date();
    // Thu hồi mọi phiên: tài khoản không active đã bị chặn ở loadUser, nhưng tăng sessionVersion để cookie cũ không "sống lại" khi kích hoạt lại.
    data.sessionVersion = { increment: 1 };
  }
  if (fields.active === true && !e.active) data.leftAt = null;
  // Nhân viên xoay ca không dùng mẫu tuần; ca cố định LUÔN có mẫu tuần trong Cấu hình (v1.12.1) — thiếu thì gán mẫu tương đương
  // "T2–T7 = ca mặc định, CN nghỉ" (lịch từng ngày y như trước).
  if ((fields.scheduleType ?? e.scheduleType) === "ROTATING") data.workPatternId = null;
  if (fields.workPatternId && !(await prisma.workPattern.findUnique({ where: { id: fields.workPatternId } }))) throw badRequest("Mẫu tuần không tồn tại");
  if (fields.defaultShiftId && !(await prisma.shift.findUnique({ where: { id: fields.defaultShiftId } }))) throw badRequest("Ca mặc định không tồn tại");
  if (fields.departmentId && !(await prisma.department.findUnique({ where: { id: fields.departmentId } }))) throw badRequest("Phòng ban không tồn tại");
  await assertCatalogIds(fields);
  // Kiểm xong mới gán (không để lại mẫu mới tạo khi lượt sửa bị từ chối).
  if ((fields.scheduleType ?? e.scheduleType) === "FIXED" && !("workPatternId" in data ? data.workPatternId : e.workPatternId)) {
    data.workPatternId = (await ensurePatternFor((fields.defaultShiftId ?? e.defaultShiftId) as number)).id;
  }
  // Mật khẩu tạm ngẫu nhiên (không dùng mật khẩu mặc định đoán được), bắt buộc đổi ở lần đăng nhập sau.
  const tempPassword = resetPassword ? randomTempPassword() : null;
  if (resetPassword) {
    data.passwordHash = await bcrypt.hash(tempPassword!, 10);
    data.mustChangePassword = true;
    data.failedLogins = 0;
    data.lockedUntil = null;
    // Thu hồi mọi phiên đang mở của người này (kể cả phiên bị lộ) — không để phiên cũ "sống lại" sau khi đổi mật khẩu tạm.
    data.sessionVersion = { increment: 1 };
  }
  if (unlinkZalo) {
    data.zaloUserId = null;
    data.zaloLinkedAt = null;
  }
  // Đổi vai trò khỏi MANAGER: gỡ khỏi vị trí quản lý phòng — cùng giao dịch với cập nhật hồ sơ (cập nhật lỗi thì không gỡ).
  const detachManager = (!!fields.role && fields.role !== "MANAGER" && e.role === "MANAGER") || fields.active === false;
  await ensureBaseline([id]);
  await prisma.$transaction([
    ...(detachManager ? [prisma.department.updateMany({ where: { managerId: id }, data: { managerId: null } })] : []),
    prisma.employee.update({ where: { id }, data }),
  ]);
  // Đổi cấu hình lịch: chỉ có hiệu lực từ hôm nay (công đã qua giữ nguyên).
  const deptChanged = fields.departmentId !== undefined && fields.departmentId !== e.departmentId;
  const scheduleChanged =
    deptChanged ||
    (fields.scheduleType !== undefined && fields.scheduleType !== e.scheduleType) ||
    (fields.defaultShiftId !== undefined && fields.defaultShiftId !== e.defaultShiftId) ||
    ("workPatternId" in data && (data.workPatternId ?? null) !== e.workPatternId);
  if (deptChanged) {
    // Lịch tương lai do phòng cũ xếp (có thể chỉ là nháp) không được "ăn theo" trạng thái đăng ký của phòng mới.
    const dropped = await prisma.workSchedule.deleteMany({ where: { employeeId: id, date: { gt: todayVN() } } });
    if (dropped.count) await audit({ actorId: u.id, action: "ROSTER_CHANGE", entity: "Employee", entityId: id, detail: { reason: "department-change", droppedFutureCells: dropped.count } });
  }
  if (scheduleChanged) await applyScheduleChangeFromToday([id]);
  // Nghỉ việc: xóa dữ liệu khuôn mặt (PRD mục 9). Gỡ khỏi vị trí quản lý phòng đã làm trong giao dịch ở trên.
  if (fields.active === false) {
    const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: id } });
    await clearFaceAvatar(id);
    await clearProfilePhoto(id); // ảnh tự chọn cũng là dữ liệu cá nhân: xóa khi nghỉ việc
    if (del.count) {
      invalidateFaceCache();
      await audit({ actorId: u.id, action: "FACE_DELETE", entity: "Employee", entityId: id, detail: { reason: "inactive", count: del.count } });
    }
  }
  // Chuyển vào phòng "không chấm công" bởi người không phải Quản trị: giữ lại chấm công (chỉ Quản trị được miễn).
  const keptTracked = fields.departmentId && fields.departmentId !== e.departmentId ? await keepTrackedUnlessAdmin(u.role, [id]) : 0;
  await audit({
    actorId: u.id,
    action: resetPassword ? "PASSWORD_RESET" : "EMPLOYEE_UPDATE",
    entity: "Employee",
    entityId: id,
    detail: redactPersonal({ ...fields, resetPassword: !!resetPassword, unlinkZalo: !!unlinkZalo }),
  });
  const changes: string[] = [];
  if (fields.role && fields.role !== e.role) changes.push(`vai trò ${ROLE_LABEL[e.role as Role] ?? e.role} → ${ROLE_LABEL[fields.role as Role]}`);
  if (fields.departmentId && fields.departmentId !== e.departmentId) changes.push("đổi phòng ban");
  if (fields.defaultShiftId && fields.defaultShiftId !== e.defaultShiftId) changes.push("đổi ca mặc định");
  if (fields.scheduleType && fields.scheduleType !== e.scheduleType) changes.push(fields.scheduleType === "ROTATING" ? "chuyển sang XOAY CA" : "chuyển sang CA CỐ ĐỊNH");
  if (fields.workPatternId !== undefined && fields.workPatternId !== e.workPatternId) changes.push("đổi mẫu tuần làm việc");
  if (fields.name && fields.name !== e.name) changes.push("đổi họ tên");
  if (fields.jobTitleId !== undefined && fields.jobTitleId !== e.jobTitleId) changes.push("đổi chức danh");
  if (fields.specialtyId !== undefined && fields.specialtyId !== e.specialtyId) changes.push("đổi chuyên khoa");
  if (fields.chatbotEnabled !== undefined && fields.chatbotEnabled !== e.chatbotEnabled) {
    changes.push(`Chat bot: ${fields.chatbotEnabled === true ? "ĐƯỢC DÙNG" : fields.chatbotEnabled === false ? "không được dùng" : "theo phòng"}`);
    await audit({ actorId: u.id, action: "CHATBOT_ACCESS", entity: "Employee", entityId: id, detail: { chatbotEnabled: fields.chatbotEnabled, code: e.code } });
  }
  if (fields.attendanceExempt !== undefined && fields.attendanceExempt !== e.attendanceExempt) {
    changes.push(`chấm công: ${fields.attendanceExempt === true ? "KHÔNG CHẤM CÔNG" : fields.attendanceExempt === false ? "vẫn chấm công" : "theo phòng"}`);
  }
  // Thông tin cá nhân: chỉ ghi là có cập nhật, không đưa giá trị vào tin nhóm.
  if ((["phone", "nationalId", "dateOfBirth", "gender", "address"] as const).some((k) => fields[k] !== undefined && fields[k] !== e[k])) changes.push("cập nhật thông tin cá nhân");
  if (fields.active === false && e.active) changes.push("CHO NGHỈ VIỆC (đã xóa dữ liệu khuôn mặt, thoát mọi thiết bị)");
  if (fields.active === true && !e.active) changes.push("kích hoạt lại tài khoản");
  if (keptTracked) changes.push("phòng mới không chấm công nhưng người này vẫn chấm công (chỉ Quản trị được miễn)");
  if (resetPassword) changes.push("đặt lại mật khẩu");
  if (unlinkZalo) changes.push("hủy liên kết Zalo");
  // Sửa hồ sơ của chính mình (SĐT, hủy Zalo...) là thao tác ngang quyền nhân viên — không công khai vào nhóm.
  // Nhưng tự cấp quyền cho mình (chấm công / chat bot) thì luôn phải lên nhóm minh bạch.
  const selfPersonal =
    id === u.id && !fields.role && fields.active === undefined && !fields.departmentId && fields.attendanceExempt === undefined && fields.chatbotEnabled === undefined;
  if (changes.length && !selfPersonal) {
    // always: cấp/thu quyền dùng chat bot là chuyện chi phí + dữ liệu, ai làm cũng phải hiện trên nhóm.
    const chatbotChanged = fields.chatbotEnabled !== undefined && fields.chatbotEnabled !== e.chatbotEnabled;
    await announce(u, `đã sửa hồ sơ ${e.code} — ${e.name}`, { key: onceKey("emp-update", id), detail: changes.join("; "), ...(chatbotChanged ? { always: true } : {}) });
  }
  return json({ ok: true, ...(tempPassword ? { tempPassword } : {}) });
});

/**
 * Xóa hẳn tài khoản — CHỈ cho tài khoản tạo nhầm, chưa có bất kỳ lịch sử nào.
 * Hồ sơ nhân viên là khóa của log chấm công, đơn từ, lịch, ngày đã chốt công, nhật ký (nhiều bảng không có khóa ngoại):
 * xóa khi đã có lịch sử sẽ làm bảng công tháng đã chốt mất tên người và giải phóng mã NV / SĐT cho người khác.
 * Nhân viên nghỉ việc dùng PATCH { active: false } (giữ lịch sử, xóa khuôn mặt, chặn đăng nhập).
 */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const u = await requirePerm(req, "employees.manage");
  const id = await idParam(ctx);
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound();
  if (u.id === id) throw badRequest("Không thể tự xóa tài khoản của chính mình");
  await assertCanModify(u, e, { active: false });
  const [logs, requests, schedules, locked, locks, weeks, links, facesForOthers, actions, notifications] = await Promise.all([
    prisma.attendanceLog.count({ where: { OR: [{ employeeId: id }, { createdById: id }] } }),
    prisma.leaveRequest.count({ where: { OR: [{ employeeId: id }, { approverId: id }, { managerApproverId: id }, { executedById: id }] } }),
    prisma.workSchedule.count({ where: { employeeId: id } }),
    prisma.lockedDay.count({ where: { employeeId: id } }),
    prisma.payrollLock.count({ where: { lockedById: id } }),
    prisma.rosterWeek.count({ where: { registeredById: id } }),
    prisma.infoLink.count({ where: { createdById: id } }),
    prisma.faceTemplate.count({ where: { createdById: id, employeeId: { not: id } } }),
    prisma.auditLog.count({ where: { actorId: id } }),
    prisma.notificationLog.count({ where: { toEmployeeId: id } }),
  ]);
  const reasons = [
    logs > 0 && `${logs} log chấm công (của họ hoặc do họ chấm tay)`,
    requests > 0 && `${requests} đơn từ (gửi, duyệt hoặc thực hiện)`,
    schedules > 0 && `${schedules} ô lịch tuần`,
    locked > 0 && `${locked} ngày đã chốt công`,
    locks > 0 && `${locks} lần chốt công tháng do người này thực hiện`,
    weeks > 0 && `${weeks} tuần đăng ký ca do người này thực hiện`,
    links > 0 && `${links} liên kết Thông tin do người này tạo`,
    facesForOthers > 0 && `${facesForOthers} mẫu khuôn mặt do người này enroll cho người khác`,
    actions > 0 && `${actions} thao tác trong nhật ký hệ thống`,
    notifications > 0 && `${notifications} thông báo đã gửi`,
  ].filter(Boolean);
  if (reasons.length) {
    throw badRequest(`Không thể xóa ${e.code} — ${e.name}: đã có ${reasons.join(", ")}. Hãy dùng "Nghỉ việc" (bỏ tích Đang làm việc) để giữ lịch sử.`);
  }
  try {
    await prisma.$transaction([
      prisma.department.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      prisma.zaloLinkCode.deleteMany({ where: { employeeId: id } }),
      prisma.scheduleAssignment.deleteMany({ where: { employeeId: id } }), // chỉ còn dòng baseline tạo lúc thêm nhân viên
      prisma.faceTemplate.deleteMany({ where: { employeeId: id } }),
      prisma.employee.delete({ where: { id } }),
    ]);
  } catch (err) {
    // Dữ liệu vừa phát sinh giữa lúc kiểm tra và lúc xóa (vd. quét kiosk) => khóa ngoại chặn; báo rõ thay vì 500.
    if ((err as { code?: string }).code === "P2003") throw badRequest(`Tài khoản ${e.code} vừa phát sinh dữ liệu, không thể xóa — hãy dùng "Nghỉ việc"`);
    throw err;
  }
  invalidateFaceCache();
  await deleteCredentialDir(id).catch(() => {}); // file scan văn bằng / chứng chỉ (dòng DB xóa theo cascade)
  await clearFaceAvatar(id, { dbAlreadyGone: true }).catch(() => {});
  await clearProfilePhoto(id, { dbAlreadyGone: true }).catch(() => {});
  await audit({ actorId: u.id, action: "EMPLOYEE_DELETE", entity: "Employee", entityId: id, detail: { code: e.code, name: e.name, role: e.role, departmentId: e.departmentId } });
  await announce(u, `đã xóa tài khoản tạo nhầm ${e.code} — ${e.name}`, { key: `emp-delete:${id}`, detail: "Tài khoản chưa có chấm công / đơn từ / lịch" });
  return json({ ok: true });
});
