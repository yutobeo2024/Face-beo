/**
 * Xếp ca & đăng ký ca tuần (v1.1, giai đoạn 3b).
 *
 * Lịch (WorkSchedule) chỉ có hiệu lực tính công khi tuần của phòng ban đã ĐĂNG KÝ (RosterWeek REGISTERED).
 *  - Quản lý (roster.edit): chỉ xếp/đăng ký tuần CHƯA BẮT ĐẦU (trước 00:00 thứ Hai), còn NHÁP, thuộc phòng mình.
 *  - Nhân sự / Quản trị (roster.editRegistered): xếp/đăng ký mọi lúc; sửa tuần ĐÃ ĐĂNG KÝ bắt buộc có lý do,
 *    ghi AuditLog ROSTER_CHANGE (trước/sau), gửi nhóm Zalo và tính lại công các ngày đã qua.
 * Chặn kiểu gian lận "biết mình trễ → sửa ca hôm nay → chấm → sửa lại": quản lý không đụng được tuần đang chạy.
 */
import { prisma } from "./db";
import { TRACKED_WHERE } from "./attendance-scope";
import { badRequest, forbidden } from "./api";
import { assertDept, type AuthUser } from "./auth";
import { can } from "./permissions";
import { recomputeDay } from "./attendance-service";
import { addDays, startOfWeek, todayVN, weekDates } from "./attendance";
import { audit } from "./audit";
import { announce } from "./announce";
import { fmtDate } from "./notify";
import { withLock } from "./mutex";
import { assertDatesUnlocked, lockedMonths, monthOf } from "./payroll-lock-state";

export type Cell = { employeeId: number; date: string; shiftId: number | null; isDayOff: boolean; clear?: boolean };

export const weekKey = (departmentId: number, weekStart: string) => `${departmentId}|${weekStart}`;

/** Trạng thái đăng ký của các (phòng, tuần). */
export async function weekStatuses(departmentIds: number[], weekStarts: string[]) {
  const rows = await prisma.rosterWeek.findMany({
    where: { departmentId: { in: departmentIds }, weekStart: { in: weekStarts } },
    select: { departmentId: true, weekStart: true, status: true, registeredAt: true, registeredById: true },
  });
  return new Map(rows.map((r) => [weekKey(r.departmentId, r.weekStart), r]));
}

/** Tuần đã bắt đầu chưa (thứ Hai của tuần ≤ hôm nay). */
export const weekStarted = (weekStart: string, today = todayVN()) => weekStart <= today;

/** Người dùng có được sửa lịch của (phòng, tuần) này không, và có cần lý do không. */
export async function editRule(u: AuthUser, departmentId: number, weekStart: string, registered: boolean) {
  // Phạm vi phòng ban kiểm tra TRƯỚC: kể cả khi Quản trị cấp roster.editRegistered cho vai trò Quản lý.
  try {
    assertDept(u, departmentId);
  } catch {
    return { allowed: false, needReason: false, reason: "Phòng ban ngoài phạm vi quản lý" as string | null };
  }
  const privileged = await can(u, "roster.editRegistered");
  if (privileged) return { allowed: true, needReason: registered, reason: null as string | null };
  if (!(await can(u, "roster.edit"))) return { allowed: false, needReason: false, reason: "Không có quyền xếp ca" };
  if (registered) return { allowed: false, needReason: false, reason: "Tuần đã đăng ký — chỉ Nhân sự sửa được" };
  if (weekStarted(weekStart)) return { allowed: false, needReason: false, reason: "Tuần đã bắt đầu — quá hạn đăng ký, liên hệ Nhân sự" };
  return { allowed: true, needReason: false, reason: null };
}

type SchedRow = { shiftId: number | null; isDayOff: boolean } | null;
const describe = (s: SchedRow, shiftName: (id: number) => string) => (!s ? "mặc định" : s.isDayOff || s.shiftId == null ? "Nghỉ" : shiftName(s.shiftId));

/** Mọi thao tác ghi lịch / đăng ký tuần chạy tuần tự để trạng thái tuần không đổi giữa lúc kiểm tra và lúc ghi. */
const ROSTER_LOCK = "roster-write";

export function applyCells(u: AuthUser, cells: Cell[], reason?: string | null) {
  return withLock(ROSTER_LOCK, () => applyCellsLocked(u, cells, reason));
}

async function applyCellsLocked(u: AuthUser, allCells: Cell[], reason?: string | null) {
  // Ô thuộc tháng đã chốt công: bỏ qua (vd. sao chép tuần giáp ranh tháng); nếu mọi ô đều đã chốt => 409.
  const locked = await lockedMonths();
  const cells = allCells.filter((c) => !locked.has(monthOf(c.date)));
  const skippedLocked = allCells.length - cells.length;
  if (!cells.length && allCells.length) await assertDatesUnlocked(allCells.map((c) => c.date));
  const ids = [...new Set(cells.map((c) => c.employeeId))];
  const emps = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, departmentId: true } });
  // v1.12.0: không xếp ca cho người không chấm công.
  const trackedIds = new Set((await prisma.employee.findMany({ where: { AND: [{ id: { in: ids } }, TRACKED_WHERE] }, select: { id: true } })).map((e) => e.id));
  const notTracked = emps.find((e) => !trackedIds.has(e.id));
  if (notTracked) throw badRequest(`${notTracked.code} — ${notTracked.name} thuộc diện không chấm công, không xếp ca`);
  const empById = new Map(emps.map((e) => [e.id, e]));
  const weeks = [...new Set(cells.map((c) => startOfWeek(c.date)))];
  const statuses = await weekStatuses([...new Set(emps.map((e) => e.departmentId))], weeks);
  const shifts = new Map((await prisma.shift.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const shiftName = (id: number) => shifts.get(id) ?? `ca #${id}`;

  // Kiểm tra toàn bộ trước khi ghi (tất cả hoặc không gì cả).
  const plan: { c: Cell; e: (typeof emps)[number]; registered: boolean }[] = [];
  for (const c of cells) {
    if (!c.clear && !c.isDayOff && c.shiftId != null && !shifts.has(c.shiftId)) throw badRequest(`Ca #${c.shiftId} không tồn tại`);
    const e = empById.get(c.employeeId);
    if (!e) throw forbidden("Nhân viên không tồn tại");
    const registered = statuses.get(weekKey(e.departmentId, startOfWeek(c.date)))?.status === "REGISTERED";
    const rule = await editRule(u, e.departmentId, startOfWeek(c.date), registered);
    if (!rule.allowed) throw forbidden(`${e.code} ngày ${fmtDate(c.date)}: ${rule.reason}`);
    if (rule.needReason && (reason ?? "").trim().length < 5) {
      throw badRequest("Sửa lịch của tuần đã đăng ký bắt buộc nhập lý do (tối thiểu 5 ký tự)");
    }
    plan.push({ c, e, registered });
  }

  const today = todayVN();
  const changes: { employeeId: number; code: string; name: string; date: string; before: string; after: string; weekKey: string }[] = [];
  const recompute = new Set<string>();
  const existing = await prisma.workSchedule.findMany({
    where: { OR: plan.map(({ c }) => ({ employeeId: c.employeeId, date: c.date })) },
  });
  const beforeOf = new Map(existing.map((x) => [`${x.employeeId}|${x.date}`, x]));
  const writes: { c: Cell; e: (typeof emps)[number]; registered: boolean; before: SchedRow; after: SchedRow }[] = plan.map(({ c, e, registered }) => ({
    c,
    e,
    registered,
    before: beforeOf.get(`${c.employeeId}|${c.date}`) ?? null,
    after: c.clear ? null : { shiftId: c.isDayOff ? null : c.shiftId, isDayOff: c.isDayOff || c.shiftId == null },
  }));
  await prisma.$transaction(
    writes.map(({ c, after }) =>
      after
        ? prisma.workSchedule.upsert({
            where: { employeeId_date: { employeeId: c.employeeId, date: c.date } },
            create: { employeeId: c.employeeId, date: c.date, ...after },
            update: after,
          })
        : prisma.workSchedule.deleteMany({ where: { employeeId: c.employeeId, date: c.date } }),
    ),
  );
  for (const { c, e, registered, before, after } of writes) {
    if (registered) {
      const b = describe(before, shiftName);
      const a = describe(after, shiftName);
      if (b !== a) changes.push({ employeeId: e.id, code: e.code, name: e.name, date: c.date, before: b, after: a, weekKey: weekKey(e.departmentId, startOfWeek(c.date)) });
      // Lịch đã có hiệu lực: tính lại công những ngày đã qua / hôm nay (ca đêm: cả ngày kế).
      if (c.date <= today) recompute.add(`${c.employeeId}|${c.date}`);
    }
  }
  for (const k of recompute) {
    const [id, d] = k.split("|");
    await recomputeDay(Number(id), d);
  }
  if (changes.length) {
    for (const wk of new Set(changes.map((x) => x.weekKey))) {
      await audit({ actorId: u.id, action: "ROSTER_CHANGE", entity: "RosterWeek", entityId: wk, detail: { reason, changes: changes.filter((x) => x.weekKey === wk) } });
    }
    const lines = changes.slice(0, 15).map((x) => `• ${x.code} ${x.name} — ${fmtDate(x.date)}: ${x.before} → ${x.after}`);
    if (changes.length > 15) lines.push(`… và ${changes.length - 15} ô khác`);
    await announce(u, `đã SỬA lịch ca đã đăng ký (${changes.length} ô)`, { key: `roster-change:${Date.now()}:${u.id}`, detail: lines.join("\n"), reason, always: true });
  }
  return { saved: plan.length, changed: changes.length, skippedLocked };
}

/** Đăng ký (khóa) ca tuần cho các phòng ban. Đăng ký muộn (tuần đã bắt đầu) chỉ Nhân sự/Quản trị, và tính lại công. */
export function registerWeeks(u: AuthUser, departmentIds: number[], weekInput: string) {
  return withLock(ROSTER_LOCK, () => registerWeeksLocked(u, departmentIds, weekInput));
}

async function registerWeeksLocked(u: AuthUser, departmentIds: number[], weekInput: string) {
  const week = startOfWeek(weekInput);
  // Tuần nằm trọn trong tháng đã chốt công => chặn (tuần giáp ranh vẫn đăng ký được; ngày đã chốt giữ bản chụp).
  const locked = await lockedMonths();
  if (weekDates(week).every((d) => locked.has(monthOf(d)))) await assertDatesUnlocked([week]);
  const privileged = await can(u, "roster.editRegistered");
  const depts = await prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } });
  if (depts.length !== new Set(departmentIds).size) throw badRequest("Phòng ban không hợp lệ");
  for (const d of depts) {
    assertDept(u, d.id);
    if (!privileged && weekStarted(week)) throw forbidden(`${d.name}: tuần đã bắt đầu — quá hạn đăng ký, liên hệ Nhân sự`);
  }
  const existing = await weekStatuses(depts.map((d) => d.id), [week]);
  const registered: string[] = [];
  for (const d of depts) {
    if (existing.get(weekKey(d.id, week))?.status === "REGISTERED") continue;
    await prisma.rosterWeek.upsert({
      where: { departmentId_weekStart: { departmentId: d.id, weekStart: week } },
      create: { departmentId: d.id, weekStart: week, status: "REGISTERED", registeredById: u.id, registeredAt: new Date() },
      update: { status: "REGISTERED", registeredById: u.id, registeredAt: new Date() },
    });
    await audit({ actorId: u.id, action: "ROSTER_REGISTER", entity: "RosterWeek", entityId: weekKey(d.id, week), detail: { late: weekStarted(week) } });
    registered.push(d.name);
    // Đăng ký muộn: lịch vừa có hiệu lực cho các ngày đã qua => gán lại ca cho log cũ.
    if (weekStarted(week)) {
      // Chỉ những ngày có log mới cần gán lại ca (không log => không có gì để tính lại).
      const today = todayVN();
      const days = await prisma.attendanceLog.findMany({
        where: { employee: { departmentId: d.id }, workDate: { gte: addDays(week, -1), lte: addDays(week, 7) } },
        select: { employeeId: true, workDate: true },
        distinct: ["employeeId", "workDate"],
      });
      const todo = new Set<string>();
      for (const x of days) for (const date of weekDates(week)) if (date <= today && Math.abs(Date.parse(date) - Date.parse(x.workDate)) <= 86_400_000) todo.add(`${x.employeeId}|${date}`);
      for (const k of todo) {
        const [id, date] = k.split("|");
        await recomputeDay(Number(id), date);
      }
    }
  }
  if (registered.length) {
    await announce(u, `đã ĐĂNG KÝ ca tuần ${fmtDate(week)}–${fmtDate(addDays(week, 6))}`, {
      key: `roster-register:${week}:${depts.map((d) => d.id).join(",")}:${Date.now()}`,
      detail: `Phòng: ${registered.join(", ")}${weekStarted(week) ? " (đăng ký muộn — đã tính lại công)" : ""}`,
      always: true,
    });
  }
  return { registered: registered.length, week };
}
