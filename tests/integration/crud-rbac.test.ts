/// <reference types="vite/client" />
/** API + DB acceptance tests for 981a042. No application code is mocked. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { CAPABILITIES, DEFAULT_MATRIX, LOCKED_CAPS, can, invalidatePermissionCache, saveMatrix, type Capability } from "@/lib/permissions";
import { addDays, todayVN, vnDateTime } from "@/lib/attendance";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { saveSnapshot, snapshotDir } from "@/lib/storage";
import { ctx, readXlsx, req, sessionCookie } from "./helpers";

type Handler = (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>;
const modules = import.meta.glob<Record<string, Handler>>("../../src/app/api/**/route.ts", { eager: true });
const roles = ["ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const;
type Role = typeof roles[number];
// Match the API's uppercase normalization even for fixtures inserted directly.
const tag = `RB${randomUUID().slice(0, 8)}`.toUpperCase();
const missing = 2147483647;
let seq = 0;
let deptA: number, deptB: number, shiftId: number;
const users = {} as Record<Role, number>;
const cookies = {} as Record<Role, string>;
let outsider: number;
let savedPermissions: { role: string; capability: string }[];
const defaults = () => ({ HR: [...DEFAULT_MATRIX.HR], MANAGER: [...DEFAULT_MATRIX.MANAGER], EMPLOYEE: [...DEFAULT_MATRIX.EMPLOYEE] });

async function call(path: string, method = "GET", cookie?: string, body?: unknown, params: Record<string, string | string[]> = {}) {
  const handler = modules[`../../src/app/api/${path.split("?")[0]}/route.ts`]?.[method];
  if (!handler) throw new Error(`No handler: ${method} ${path}`);
  return handler(req(`/api/${path}`, { method, cookie, body }), ctx(params));
}
const as = (role: Role, path: string, method = "GET", body?: unknown, params?: Record<string, string | string[]>) => call(path, method, cookies[role], body, params);
const employee = (role: Role, id: number, method = "GET", body?: unknown) => as(role, "employees/[id]", method, body, { id: String(id) });
async function createFixture(role: Role = "EMPLOYEE", departmentId = deptA) {
  const e = await prisma.employee.create({ data: {
    code: `${tag}${++seq}`, name: `${tag} ${role}`, phone: `09${randomInt(100000000).toString().padStart(8, "0")}`,
    passwordHash: await bcrypt.hash("Fixture123", 4), role, departmentId, defaultShiftId: shiftId, mustChangePassword: false,
  } });
  return e.id;
}
async function deniedState() {
  return {
    employees: await prisma.employee.findMany({ where: { code: { startsWith: tag } }, orderBy: { id: "asc" } }),
    departments: await prisma.department.findMany({ where: { id: { in: [deptA, deptB] } }, orderBy: { id: "asc" } }),
    audits: await prisma.auditLog.count(), notifications: await prisma.notificationLog.count(),
  };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  savedPermissions = await prisma.rolePermission.findMany();
  await saveMatrix(defaults());
  shiftId = (await prisma.shift.create({ data: { name: `${tag} shift`, startTime: "08:00", endTime: "17:00", breakMinutes: 60 } })).id;
  deptA = (await prisma.department.create({ data: { name: `${tag} A` } })).id;
  deptB = (await prisma.department.create({ data: { name: `${tag} B` } })).id;
  for (const role of roles) { users[role] = await createFixture(role); cookies[role] = await sessionCookie(users[role]); }
  outsider = await createFixture("EMPLOYEE", deptB);
  await prisma.department.update({ where: { id: deptA }, data: { managerId: users.MANAGER } });
});

afterEach(async () => { await saveMatrix(defaults()); });
afterAll(async () => {
  // Only delete fixtures owned by this file, including fixtures created by a failed assertion.
  const ids = (await prisma.employee.findMany({ where: { code: { startsWith: tag } }, select: { id: true } })).map(e => e.id);
  const depIds = (await prisma.department.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map(d => d.id);
  await prisma.department.updateMany({ where: { managerId: { in: ids } }, data: { managerId: null } });
  await prisma.notificationLog.deleteMany({ where: { toEmployeeId: { in: ids } } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.leaveRequest.deleteMany({ where: { OR: [{ employeeId: { in: ids } }, { approverId: { in: ids } }] } });
  await prisma.workSchedule.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.lockedDay.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.zaloLinkCode.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.rosterWeek.deleteMany({ where: { departmentId: { in: depIds } } });
  await prisma.departmentShiftWeight.deleteMany({ where: { departmentId: { in: depIds } } });
  await prisma.department.deleteMany({ where: { id: { in: depIds } } });
  await prisma.workPattern.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.shift.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.holiday.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.kioskDevice.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$transaction([prisma.rolePermission.deleteMany(), prisma.rolePermission.createMany({ data: savedPermissions })]);
  invalidatePermissionCache(); invalidateFaceCache();
});

// Explicit API contract: rights are not discovered from the handler under test.
// Writes use invalid IDs / empty bodies, so this table checks the permission gate,
// not successful CRUD (tested separately below and in the existing domain suites).
const gates: [string, string, Capability[]][] = [
  ["employees", "GET", ["employees.view", "employees.manage"]], ["employees", "POST", ["employees.manage"]],
  ["employees/[id]", "PATCH", ["employees.manage"]],
  ["employees/[id]/consent", "POST", ["faces.enroll"]], ["employees/[id]/faces", "POST", ["faces.enroll"]], ["employees/[id]/faces", "DELETE", ["faces.enroll"]],
  ["departments", "POST", ["org.manage"]], ["departments/[id]", "PATCH", ["org.manage"]], ["departments/[id]", "DELETE", ["org.manage"]],
  ["holidays/[date]", "PATCH", ["org.manage"]],
  ["shifts", "POST", ["org.manage"]], ["shifts/[id]", "PATCH", ["org.manage"]], ["shifts/[id]", "DELETE", ["org.manage"]],
  ["work-patterns", "POST", ["org.manage"]], ["work-patterns/[id]", "PATCH", ["org.manage"]], ["work-patterns/[id]", "DELETE", ["org.manage"]],
  ["holidays", "POST", ["org.manage"]], ["holidays/[date]", "DELETE", ["org.manage"]],
  ["links", "GET", ["links.manage"]], ["links", "POST", ["links.manage"]], ["links/[id]", "PATCH", ["links.manage"]], ["links/[id]", "DELETE", ["links.manage"]],
  ["shift-weights", "GET", ["org.manage"]], ["shift-weights", "PUT", ["org.manage"]],
  ["dashboard", "GET", ["dashboard.view"]], ["attendance", "GET", ["attendance.view"]],
  ["attendance/manual", "POST", ["attendance.manualDirect"]], ["attendance/[id]", "DELETE", ["attendance.delete"]],
  ["attendance/suspicious", "GET", ["suspicious.view"]],
  ["roster", "GET", ["roster.view"]], ["roster", "PUT", ["roster.edit"]], ["roster/history", "GET", ["roster.view"]],
  ["roster/register", "POST", ["roster.edit"]], ["roster/copy-week", "POST", ["roster.edit"]],
  ["requests/[id]/decide", "POST", ["requests.decide"]], ["requests/[id]/execute", "POST", ["attendance.executeCorrection"]],
  ["reports/summary", "GET", ["reports.view"]], ["reports/attendance.xlsx", "GET", ["reports.view"]],
  ["payroll-locks", "GET", ["reports.view", "payroll.lock"]], ["payroll-locks", "POST", ["payroll.lock"]], ["payroll-locks/[month]", "DELETE", ["payroll.unlock"]],
  ["devices", "GET", ["devices.manage"]], ["devices", "POST", ["devices.manage"]], ["devices/[id]/pair-code", "POST", ["devices.manage"]], ["devices/[id]/revoke", "POST", ["devices.manage"]],
  ["settings", "GET", ["settings.system"]], ["settings", "PUT", ["settings.system"]],
  ["permissions", "GET", ["permissions.manage"]], ["permissions", "PUT", ["permissions.manage"]],
];
const probe = (path: string, method: string, cookie?: string) => call(path, method, cookie, method === "GET" ? undefined : {}, { id: "0", date: "invalid", month: "invalid" });

describe("RBAC endpoint matrix: default roles and anonymous", () => {
  for (const [path, method, caps] of gates) {
    it(`${method} ${path}: anonymous => 401`, async () => {
      expect((await probe(path, method)).status).toBe(401);
    });
    for (const role of roles) it(`${method} ${path}: ${role}`, async () => {
      const granted = role === "ADMIN" || caps.some(c => (DEFAULT_MATRIX[role] as readonly string[]).includes(c));
      const res = await probe(path, method, cookies[role]);
      if (granted) expect([200, 400, 404], await res.text()).toContain(res.status);
      else expect(res.status).toBe(403);
    });
  }
  for (const path of ["departments", "shifts", "work-patterns", "holidays", "requests", "requests/prefill", "me/attendance", "me/overview", "me/notifications", "me/zalo", "me/links", "auth/me", "employees/[id]", "snapshots/[...path]"]) {
    it(`GET ${path}: anonymous => 401`, async () => {
      expect((await call(path, "GET", undefined, undefined, { id: "0", path: ["invalid"] })).status).toBe(401);
    });
  }
  for (const [path, method] of [["requests", "POST"], ["requests/[id]/cancel", "POST"], ["employees/[id]/consent", "DELETE"], ["auth/change-password", "POST"], ["me/zalo", "POST"], ["me/zalo", "DELETE"]]) {
    it(`${method} ${path}: anonymous => 401`, async () => { expect((await probe(path, method)).status).toBe(401); });
  }
});

describe("Dynamic matrix, sessions and scope", () => {
  for (const role of ["HR", "MANAGER", "EMPLOYEE"] as const) {
    for (const { key } of CAPABILITIES) it(`${role}: grant/revoke ${key}, locked rights stay ADMIN-only`, async () => {
      const matrix: Record<"HR" | "MANAGER" | "EMPLOYEE", string[]> = { HR: [], MANAGER: [], EMPLOYEE: [] };
      matrix[role] = [key];
      const response = await as("ADMIN", "permissions", "PUT", { matrix, reason: "RBAC capability acceptance" });
      if (LOCKED_CAPS.has(key)) {
        expect(response.status).toBe(400);
        expect(await can({ role }, key)).toBe(false);
      } else {
        expect(response.status).toBe(200);
        expect(await can({ role }, key)).toBe(true);
        for (const [path, method, caps] of gates.filter(([, , caps]) => caps.includes(key))) {
          const allowed = await probe(path, method, cookies[role]);
          expect([200, 400, 404], `${role} ${method} ${path} granted ${caps.join("|")}: ${await allowed.text()}`).toContain(allowed.status);
        }
        matrix[role] = [];
        expect((await as("ADMIN", "permissions", "PUT", { matrix, reason: "RBAC revoke acceptance" })).status).toBe(200);
        expect(await can({ role }, key)).toBe(false);
        for (const [path, method] of gates.filter(([, , caps]) => caps.includes(key))) {
          expect((await probe(path, method, cookies[role])).status, `${role} ${method} ${path} revoked`).toBe(403);
        }
        invalidatePermissionCache();
        expect(await can({ role }, key)).toBe(false);
      }
      expect(await can({ role: "ADMIN" }, key)).toBe(true);
    });
  }
  it("revoking every capability denies every capability-gated endpoint immediately", async () => {
    await saveMatrix({ HR: [], MANAGER: [], EMPLOYEE: [] });
    for (const role of ["HR", "MANAGER", "EMPLOYEE"] as const) for (const [path, method] of gates) {
      expect((await probe(path, method, cookies[role])).status, `${role} ${method} ${path}`).toBe(403);
    }
  });
  it("inactive / must-change-password / changed role apply to an already issued JWT", async () => {
    const id = await createFixture("HR"); const cookie = await sessionCookie(id);
    expect((await call("employees", "GET", cookie)).status).toBe(200);
    await prisma.employee.update({ where: { id }, data: { active: false } });
    expect((await call("employees", "GET", cookie)).status).toBe(401);
    await prisma.employee.update({ where: { id }, data: { active: true, mustChangePassword: true } });
    expect((await call("employees", "GET", cookie)).status).toBe(403);
    expect((await call("auth/me", "GET", cookie)).status).toBe(200);
    const changed = await call("auth/change-password", "POST", cookie, { currentPassword: "Fixture123", newPassword: "Changed123" });
    expect(changed.status).toBe(200);
    // Đổi mật khẩu thu hồi phiên cũ (v1.4.4); phiên mới được cấp trong phản hồi.
    expect((await call("employees", "GET", cookie)).status).toBe(401);
    const fresh = changed.headers.get("set-cookie")!.split(";")[0];
    expect((await call("employees", "GET", fresh)).status).toBe(200);
    await prisma.employee.update({ where: { id }, data: { role: "EMPLOYEE" } });
    expect((await call("employees", "GET", fresh)).status).toBe(403);
  });
  it("lists, detail and query filters cannot reveal another department; personal data stays private", async () => {
    const own = await (await employee("MANAGER", users.EMPLOYEE)).json();
    expect(own.employee.id).toBe(users.EMPLOYEE); expect(own.employee.phone).toBeUndefined();
    expect(own.employee.passwordHash).toBeUndefined();
    expect((await employee("MANAGER", outsider)).status).toBe(403);
    expect((await employee("EMPLOYEE", outsider)).status).toBe(403);
    expect((await employee("EMPLOYEE", users.EMPLOYEE)).status).toBe(200);
    for (const suffix of ["", `?departmentId=${deptB}`, `?q=${tag}&includeInactive=1`]) {
      const data = await (await as("MANAGER", `employees${suffix}`)).json();
      expect(data.employees.every((e: { departmentId: number }) => e.departmentId === deptA)).toBe(true);
    }
    const ds = await (await as("MANAGER", "departments")).json();
    expect(ds.departments.map((d: { id: number }) => d.id)).toEqual([deptA]);
  });
  it("granted employee management remains department-scoped; denied updates have no side effects", async () => {
    const matrix = defaults(); matrix.MANAGER.push("employees.manage"); await saveMatrix(matrix);
    const before = await deniedState();
    expect((await employee("MANAGER", outsider, "PATCH", { name: "Unauthorized rename" })).status).toBe(403);
    expect((await employee("MANAGER", users.EMPLOYEE, "PATCH", { departmentId: deptB })).status).toBe(403);
    expect((await employee("MANAGER", users.EMPLOYEE, "PATCH", { role: "ADMIN" })).status).toBe(403);
    expect(await deniedState()).toEqual(before);
    expect((await employee("MANAGER", users.EMPLOYEE, "PATCH", { name: `${tag} allowed` })).status).toBe(200);
  });
  it("reports, Excel and roster filter other departments at the data layer", async () => {
    const day = todayVN();
    const foreign = await prisma.employee.findUniqueOrThrow({ where: { id: outsider } });
    for (const path of [`reports/summary?from=${day}&to=${day}&departmentId=${deptB}`, `roster?week=${day}&group=all&departmentId=${deptB}`, `dashboard?departmentId=${deptB}`]) {
      const r = await as("MANAGER", path); expect(r.status).toBe(200);
      expect(await r.text()).not.toContain(foreign.code);
    }
    const r = await as("MANAGER", `reports/attendance.xlsx?from=${day}&to=${day}&departmentId=${deptB}`);
    expect(r.status).toBe(200);
    const workbook = await readXlsx(await r.arrayBuffer());
    expect(JSON.stringify(workbook.SheetNames.map(n => workbook.rows(n)))).not.toContain(foreign.code);
  });
  it("snapshot content: ADMIN/HR/own manager allowed, employee and other manager denied", async () => {
    const url = await saveSnapshot(Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]));
    const parts = url.replace("/api/snapshots/", "").split("/");
    const log = await prisma.attendanceLog.create({ data: { employeeId: users.EMPLOYEE, workDate: todayVN(), checkTime: new Date(), type: "IN", snapshotUrl: url } });
    const otherId = await createFixture("MANAGER", deptB);
    await prisma.department.update({ where: { id: deptB }, data: { managerId: otherId } });
    const otherCookie = await sessionCookie(otherId);
    try {
      for (const role of ["ADMIN", "HR", "MANAGER"] as const) {
        const r = await as(role, "snapshots/[...path]", "GET", undefined, { path: parts });
        expect(r.status).toBe(200); expect(new Uint8Array(await r.arrayBuffer())).toHaveLength(8);
      }
      expect((await as("EMPLOYEE", "snapshots/[...path]", "GET", undefined, { path: parts })).status).toBe(403);
      expect((await call("snapshots/[...path]", "GET", otherCookie, undefined, { path: parts })).status).toBe(403);
    } finally {
      await prisma.attendanceLog.delete({ where: { id: log.id } });
      await unlink(join(snapshotDir(), ...parts));
      await prisma.department.update({ where: { id: deptB }, data: { managerId: null } });
    }
  });
});

describe("CRUD employees and organization", () => {
  const payload = () => ({ code: `${tag}${++seq}`, name: `${tag} Created`, phone: `09${randomInt(100000000).toString().padStart(8, "0")}`, role: "EMPLOYEE", departmentId: deptA, defaultShiftId: shiftId });
  it("employee: create, read, update, reset password, transfer, deactivate, reactivate; audit and secret redaction", async () => {
    const body = payload();
    const response = await as("HR", "employees", "POST", body); expect(response.status).toBe(201);
    const id = (await response.json()).employee.id;
    expect(await prisma.scheduleAssignment.count({ where: { employeeId: id } })).toBe(1);
    expect((await employee("HR", id)).status).toBe(200);
    expect((await employee("HR", id, "PATCH", { name: `${tag} Updated`, scheduleType: "ROTATING" })).status).toBe(200);
    const reset = await employee("HR", id, "PATCH", { resetPassword: true }); expect(reset.status).toBe(200);
    const { tempPassword } = await reset.json();
    const saved = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect(saved.mustChangePassword).toBe(true); expect(await bcrypt.compare(tempPassword, saved.passwordHash)).toBe(true);
    expect((await employee("HR", id, "PATCH", { departmentId: deptB })).status).toBe(200);
    expect((await employee("MANAGER", id)).status).toBe(403);
    const cookie = await sessionCookie(id);
    expect((await employee("HR", id, "PATCH", { active: false })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).leftAt).not.toBeNull();
    expect((await call("auth/me", "GET", cookie)).status).toBe(401);
    const active = await (await as("HR", `employees?q=${body.code}`)).json(); expect(active.employees).toHaveLength(0);
    const inactive = await (await as("HR", `employees?q=${body.code}&includeInactive=1`)).json(); expect(inactive.employees).toHaveLength(1);
    expect(JSON.stringify(inactive)).not.toContain("passwordHash");
    expect((await employee("HR", id, "PATCH", { active: true })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).leftAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: "Employee", entityId: String(id), action: "EMPLOYEE_CREATE" } })).toBe(1);
  });
  it("employee: duplicate code/phone, malformed body, missing references do not create rows", async () => {
    const existing = await prisma.employee.findUniqueOrThrow({ where: { id: users.EMPLOYEE } });
    for (const body of [{}, { ...payload(), code: existing.code }, { ...payload(), phone: existing.phone }, { ...payload(), defaultShiftId: missing }, { ...payload(), departmentId: missing }, { ...payload(), workPatternId: missing }]) {
      const before = await deniedState();
      expect((await as("HR", "employees", "POST", body)).status).toBe(400);
      expect(await deniedState()).toEqual(before);
    }
    expect((await employee("ADMIN", missing)).status).toBe(404);
    expect((await employee("ADMIN", missing, "PATCH", { name: "Missing employee" })).status).toBe(404);
  });
  it("department DELETE: only an empty department; weights cascade, info links lose the dept (hidden when empty); scope enforced", async () => {
    const mk = async (name: string) => (await (await as("ADMIN", "departments", "POST", { name })).json()).department.id as number;
    const del = (role: Role, id: number) => as(role, "departments/[id]", "DELETE", undefined, { id: String(id) });
    // 1) Phòng có nhân viên (kể cả đã nghỉ) => 400, không xóa.
    const withLeft = await mk(`${tag} dept with leaver`);
    const leaver = await createFixture("EMPLOYEE", withLeft);
    await prisma.employee.update({ where: { id: leaver }, data: { active: false } });
    const r1 = await del("ADMIN", withLeft);
    expect(r1.status).toBe(400); expect((await r1.json()).error).toMatch(/nhân viên/);
    expect(await prisma.department.findUnique({ where: { id: withLeft } })).not.toBeNull();
    // 2) Phòng trống nhưng có tuần đã đăng ký / ngày đã chốt => 400.
    const withWeek = await mk(`${tag} dept with week`);
    await prisma.rosterWeek.create({ data: { departmentId: withWeek, weekStart: "2097-01-06", status: "REGISTERED" } });
    const r2 = await del("ADMIN", withWeek);
    expect(r2.status).toBe(400); expect((await r2.json()).error).toMatch(/tuần/);
    await prisma.rosterWeek.deleteMany({ where: { departmentId: withWeek } });
    await prisma.lockedDay.create({ data: { employeeId: users.EMPLOYEE, workDate: "2097-01-06", month: "2097-01", departmentId: withWeek, data: "{}" } });
    expect((await del("ADMIN", withWeek)).status).toBe(400);
    await prisma.lockedDay.deleteMany({ where: { departmentId: withWeek } });
    // 3) Phòng trống: hệ số riêng bị xóa, liên kết Thông tin gỡ phòng (rỗng => ẩn), phòng biến mất.
    await prisma.departmentShiftWeight.create({ data: { departmentId: withWeek, shiftId, workDayValue: 0.5 } });
    const onlyThis = await prisma.infoLink.create({ data: { title: `${tag} link only`, url: "https://x.y", visibleDeptIds: JSON.stringify([withWeek]) } });
    const shared = await prisma.infoLink.create({ data: { title: `${tag} link shared`, url: "https://x.y", visibleDeptIds: JSON.stringify([deptA, withWeek]) } });
    try {
      expect((await del("MANAGER", withWeek)).status).toBe(403); // ngoài phạm vi quản lý
      expect((await del("HR", withWeek)).status).toBe(403); // HR mặc định không có org.manage
      expect((await del("ADMIN", withWeek)).status).toBe(200);
      expect(await prisma.department.findUnique({ where: { id: withWeek } })).toBeNull();
      expect(await prisma.departmentShiftWeight.count({ where: { departmentId: withWeek } })).toBe(0);
      const a = await prisma.infoLink.findUniqueOrThrow({ where: { id: onlyThis.id } });
      expect(a.visibleDeptIds).toBe("[]"); expect(a.active).toBe(false);
      const b = await prisma.infoLink.findUniqueOrThrow({ where: { id: shared.id } });
      expect(b.visibleDeptIds).toBe(JSON.stringify([deptA])); expect(b.active).toBe(true);
      expect((await del("ADMIN", withWeek)).status).toBe(404);
    } finally { await prisma.infoLink.deleteMany({ where: { title: { startsWith: tag } } }); }
  });
  it("holiday PATCH: rename keeps date; moving date replaces the row; collision 400; unknown 404", async () => {
    const d1 = "2097-04-30", d2 = "2097-05-01", d3 = "2097-05-02";
    await prisma.holiday.deleteMany({ where: { date: { in: [d1, d2, d3] } } });
    try {
      expect((await as("ADMIN", "holidays", "POST", { date: d1, name: `${tag} h1` })).status).toBe(201);
      expect((await as("ADMIN", "holidays", "POST", { date: d3, name: `${tag} h3` })).status).toBe(201);
      expect((await as("ADMIN", "holidays/[date]", "PATCH", { name: `${tag} renamed` }, { date: d1 })).status).toBe(200);
      expect((await prisma.holiday.findUniqueOrThrow({ where: { date: d1 } })).name).toBe(`${tag} renamed`);
      expect((await as("ADMIN", "holidays/[date]", "PATCH", { date: d3 }, { date: d1 })).status).toBe(400); // trùng ngày lễ khác
      expect((await as("ADMIN", "holidays/[date]", "PATCH", { date: d2 }, { date: d1 })).status).toBe(200);
      expect(await prisma.holiday.findUnique({ where: { date: d1 } })).toBeNull();
      expect((await prisma.holiday.findUniqueOrThrow({ where: { date: d2 } })).name).toBe(`${tag} renamed`);
      expect((await as("ADMIN", "holidays/[date]", "PATCH", { name: "x y" }, { date: d1 })).status).toBe(404);
      expect((await as("ADMIN", "holidays/[date]", "PATCH", {}, { date: d2 })).status).toBe(400);
      expect((await as("HR", "holidays/[date]", "PATCH", { name: "x y" }, { date: d2 })).status).toBe(403);
    } finally { await prisma.holiday.deleteMany({ where: { date: { in: [d1, d2, d3] } } }); }
  });
  it("work pattern DELETE: blocked by active users only; inactive users are detached", async () => {
    const p = await as("ADMIN", "work-patterns", "POST", { name: `${tag} pattern leavers`, monShiftId: null, tueShiftId: null, wedShiftId: null, thuShiftId: null, friShiftId: null, satShiftId: null, sunShiftId: null });
    const pid = (await p.json()).pattern.id;
    const active = await createFixture(); const left = await createFixture();
    await prisma.employee.update({ where: { id: active }, data: { workPatternId: pid } });
    await prisma.employee.update({ where: { id: left }, data: { workPatternId: pid, active: false } });
    expect((await as("ADMIN", "work-patterns/[id]", "DELETE", undefined, { id: String(pid) })).status).toBe(400);
    await prisma.employee.update({ where: { id: active }, data: { workPatternId: null } });
    expect((await as("ADMIN", "work-patterns/[id]", "DELETE", undefined, { id: String(pid) })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: left } })).workPatternId).toBeNull();
    expect(await prisma.workPattern.findUnique({ where: { id: pid } })).toBeNull();
  });
  it("department: create/read/rename/assign manager/remove manager", async () => {
    const name = `${tag} created department`;
    const res = await as("ADMIN", "departments", "POST", { name }); expect(res.status).toBe(201);
    const id = (await res.json()).department.id;
    expect((await as("ADMIN", "departments", "POST", { name })).status).toBe(400);
    const candidate = await createFixture();
    expect((await as("ADMIN", "departments/[id]", "PATCH", { name: `${tag} renamed department`, managerId: candidate }, { id: String(id) })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: candidate } })).role).toBe("MANAGER");
    expect((await prisma.department.findUniqueOrThrow({ where: { id } })).managerId).toBe(candidate);
    expect((await as("ADMIN", "departments/[id]", "PATCH", { managerId: null }, { id: String(id) })).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id } })).managerId).toBeNull();
  });
  it("shift and work pattern: complete lifecycle; referenced shift/pattern cannot be deleted", async () => {
    const body = { name: `${tag} temporary shift`, startTime: "08:00", endTime: "12:00", breakMinutes: 0, graceLateMinutes: 0, graceEarlyMinutes: 0 };
    const res = await as("ADMIN", "shifts", "POST", body); expect(res.status).toBe(201); const id = (await res.json()).shift.id;
    expect((await as("ADMIN", "shifts", "POST", body)).status).toBe(400);
    expect((await as("ADMIN", "shifts/[id]", "PATCH", { endTime: "08:00" }, { id: String(id) })).status).toBe(400);
    expect((await as("ADMIN", "shifts/[id]", "PATCH", { workDayValue: 0.5 }, { id: String(id) })).status).toBe(200);
    const pattern = { name: `${tag} pattern`, monShiftId: id, tueShiftId: null, wedShiftId: null, thuShiftId: null, friShiftId: null, satShiftId: null, sunShiftId: null };
    const p = await as("ADMIN", "work-patterns", "POST", pattern); expect(p.status).toBe(201); const pid = (await p.json()).pattern.id;
    expect((await as("ADMIN", "shifts/[id]", "DELETE", undefined, { id: String(id) })).status).toBe(400);
    const uid = await createFixture(); await prisma.employee.update({ where: { id: uid }, data: { workPatternId: pid } });
    expect((await as("ADMIN", "work-patterns/[id]", "DELETE", undefined, { id: String(pid) })).status).toBe(400);
    expect((await as("ADMIN", "work-patterns/[id]", "PATCH", { monShiftId: missing }, { id: String(pid) })).status).toBe(400);
    await prisma.employee.update({ where: { id: uid }, data: { workPatternId: null } });
    expect((await as("ADMIN", "work-patterns/[id]", "PATCH", { monShiftId: null }, { id: String(pid) })).status).toBe(200);
    expect((await as("EMPLOYEE", "work-patterns")).status).toBe(200);
    expect((await as("EMPLOYEE", "shifts")).status).toBe(200);
    expect((await as("ADMIN", "work-patterns/[id]", "DELETE", undefined, { id: String(pid) })).status).toBe(200);
    expect((await as("ADMIN", "shifts/[id]", "DELETE", undefined, { id: String(id) })).status).toBe(200);
    expect(await prisma.shift.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.workPattern.findUnique({ where: { id: pid } })).toBeNull();
  });
  it("holiday upsert/delete and department shift weights create/update/remove", async () => {
    const date = "2098-12-25";
    const previous = await prisma.holiday.findUnique({ where: { date } });
    try {
      expect((await as("ADMIN", "holidays", "POST", { date, name: `${tag} holiday` })).status).toBe(201);
      expect((await as("ADMIN", "holidays", "POST", { date, name: `${tag} revised` })).status).toBe(201);
      expect((await prisma.holiday.findUniqueOrThrow({ where: { date } })).name).toBe(`${tag} revised`);
      expect((await as("EMPLOYEE", "holidays")).status).toBe(200);
      expect((await as("ADMIN", "holidays/[date]", "DELETE", undefined, { date })).status).toBe(200);
      expect(await prisma.holiday.findUnique({ where: { date } })).toBeNull();
    } finally { if (previous) await prisma.holiday.upsert({ where: { date }, create: previous, update: previous }); }
    for (const value of [0.5, 1.25, null]) {
      expect((await as("ADMIN", "shift-weights", "PUT", { weights: [{ departmentId: deptA, shiftId, workDayValue: value }] })).status).toBe(200);
      const row = await prisma.departmentShiftWeight.findUnique({ where: { departmentId_shiftId: { departmentId: deptA, shiftId } } });
      expect(row?.workDayValue ?? null).toBe(value);
    }
    expect((await as("ADMIN", "shift-weights", "PUT", { weights: [{ departmentId: deptA, shiftId, workDayValue: 0.3 }] })).status).toBe(400);
  });
  it("devices: create/list/pair-code rotation/revoke; token hash is not exposed", async () => {
    const res = await as("ADMIN", "devices", "POST", { name: `${tag} kiosk` }); expect(res.status).toBe(201);
    const id = (await res.json()).device.id;
    expect((await as("ADMIN", "devices/[id]/pair-code", "POST", {}, { id: String(id) })).status).toBe(200);
    const list = await (await as("ADMIN", "devices")).json();
    const d = list.devices.find((v: { id: number }) => v.id === id); expect(d).toBeDefined(); expect(d.tokenHash).toBeUndefined();
    expect((await as("ADMIN", "devices/[id]/revoke", "POST", {}, { id: String(id) })).status).toBe(200);
    expect((await prisma.kioskDevice.findUniqueOrThrow({ where: { id } })).active).toBe(false);
  });
});

describe("Requests: ownership, state transitions and visibility", () => {
  async function createRequest(id: number, offset: number) {
    const date = addDays(todayVN(), offset); const cookie = await sessionCookie(id);
    const body = { type: "NGHI_PHEP", fromTime: vnDateTime(date, "08:00").toISOString(), toTime: vnDateTime(date, "12:00").toISOString(), reason: "CRUD RBAC acceptance request" };
    const r = await call("requests", "POST", cookie, body); expect(r.status).toBe(201);
    return { id: (await r.json()).request.id as number, cookie, body };
  }
  it("only owner cancels PENDING; team query cannot override employee ownership", async () => {
    const a = await createRequest(users.EMPLOYEE, 70); const b = await createRequest(outsider, 70);
    const list = await (await as("EMPLOYEE", `requests?scope=team&departmentId=${deptB}`)).json();
    expect(list.requests.some((r: { id: number }) => r.id === a.id)).toBe(true);
    expect(list.requests.some((r: { id: number }) => r.id === b.id)).toBe(false);
    for (const role of ["ADMIN", "HR", "MANAGER"] as const) expect((await as(role, "requests/[id]/cancel", "POST", {}, { id: String(a.id) })).status).toBe(403);
    expect((await as("EMPLOYEE", "requests/[id]/cancel", "POST", {}, { id: String(a.id) })).status).toBe(200);
    expect((await as("EMPLOYEE", "requests/[id]/cancel", "POST", {}, { id: String(a.id) })).status).toBe(400);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
  });
  it("approve/reject lifecycle; no self-approval, no second decision, no cancel after approval", async () => {
    const a = await createRequest(users.EMPLOYEE, 71);
    const m = defaults(); m.EMPLOYEE.push("requests.decide"); await saveMatrix(m);
    expect((await as("EMPLOYEE", "requests/[id]/decide", "POST", { action: "APPROVE" }, { id: String(a.id) })).status).toBe(403);
    expect((await as("MANAGER", "requests/[id]/decide", "POST", { action: "REJECT" }, { id: String(a.id) })).status).toBe(400);
    expect((await as("MANAGER", "requests/[id]/decide", "POST", { action: "APPROVE" }, { id: String(a.id) })).status).toBe(200);
    expect((await as("MANAGER", "requests/[id]/decide", "POST", { action: "APPROVE" }, { id: String(a.id) })).status).toBe(400);
    expect((await as("EMPLOYEE", "requests/[id]/cancel", "POST", {}, { id: String(a.id) })).status).toBe(400);
    const b = await createRequest(users.EMPLOYEE, 72);
    expect((await as("MANAGER", "requests/[id]/decide", "POST", { action: "REJECT", note: "Cannot approve this request" }, { id: String(b.id) })).status).toBe(200);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("REJECTED");
  });
});

describe("Regression assertions: invalid writes are atomic and delegated rights stay scoped", () => {
  it("attendance departmentId plus employeeId must not bypass manager data scope", async () => {
    const day = todayVN();
    await prisma.attendanceLog.create({ data: { employeeId: outsider, workDate: day, checkTime: new Date(), type: "IN", source: "MANUAL" } });
    const foreign = await prisma.employee.findUniqueOrThrow({ where: { id: outsider } });
    // A single employee filter must be safe, as must the combination with a forbidden department.
    for (const query of [`employeeId=${outsider}`, `departmentId=${deptB}&employeeId=${outsider}`]) {
      const response = await as("MANAGER", `attendance?from=${day}&to=${day}&${query}`);
      expect([200, 403]).toContain(response.status);
      expect.soft(await response.text(), query).not.toContain(foreign.code);
    }
  });
  it("delegated suspicious.view must not expose attendance from another department", async () => {
    const m = defaults(); m.MANAGER.push("suspicious.view"); await saveMatrix(m);
    const foreign = await prisma.employee.findUniqueOrThrow({ where: { id: outsider } });
    await prisma.attendanceLog.create({ data: { employeeId: outsider, workDate: todayVN(), checkTime: new Date(), type: "IN", source: "KIOSK", matchScore: 0.01 } });
    const response = await as("MANAGER", "attendance/suspicious");
    expect([200, 403]).toContain(response.status);
    expect(await response.text()).not.toContain(foreign.code);
  });
  it("manager granted org.manage cannot edit another department's shift weight", async () => {
    const m = defaults(); m.MANAGER.push("org.manage"); await saveMatrix(m);
    const before = await prisma.departmentShiftWeight.findMany({ where: { departmentId: deptB } });
    const res = await as("MANAGER", "shift-weights", "PUT", { weights: [{ departmentId: deptB, shiftId, workDayValue: 2 }] });
    expect.soft(res.status).toBe(403);
    expect(await prisma.departmentShiftWeight.findMany({ where: { departmentId: deptB } })).toEqual(before);
  });
  it("duplicate department rename + manager assignment must not partially promote an employee", async () => {
    const id = await createFixture();
    const target = await prisma.department.create({ data: { name: `${tag} atomic` } });
    const name = (await prisma.department.findUniqueOrThrow({ where: { id: deptB } })).name;
    const before = await prisma.employee.findUniqueOrThrow({ where: { id }, select: { role: true, departmentId: true } });
    const res = await as("ADMIN", "departments/[id]", "PATCH", { name, managerId: id }, { id: String(target.id) });
    expect.soft([400, 409]).toContain(res.status);
    expect(await prisma.employee.findUniqueOrThrow({ where: { id }, select: { role: true, departmentId: true } })).toEqual(before);
  });
  it("invalid employee shift + demotion must not detach managed departments", async () => {
    const id = await createFixture("MANAGER");
    const target = await prisma.department.create({ data: { name: `${tag} atomic employee`, managerId: id } });
    const res = await employee("ADMIN", id, "PATCH", { role: "EMPLOYEE", defaultShiftId: missing });
    expect.soft([400, 404]).toContain(res.status);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: target.id } })).managerId).toBe(id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).role).toBe("MANAGER");
  });
  // Positive counterparts + the sibling code paths found in review (deactivation, dashboard counter, copy-week, weight GET).
  it("manager still sees an own-department employee filtered by employeeId", async () => {
    const day = todayVN();
    await prisma.attendanceLog.create({ data: { employeeId: users.EMPLOYEE, workDate: day, checkTime: new Date(), type: "IN", source: "MANUAL" } });
    const own = await prisma.employee.findUniqueOrThrow({ where: { id: users.EMPLOYEE } });
    const response = await as("MANAGER", `attendance?from=${day}&to=${day}&employeeId=${users.EMPLOYEE}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(own.code);
  });
  it("delegated suspicious.view: manager sees own-department kiosk scans, no company-wide events; dashboard counter stays 0", async () => {
    const m = defaults(); m.MANAGER.push("suspicious.view"); await saveMatrix(m);
    const own = await prisma.employee.findUniqueOrThrow({ where: { id: users.EMPLOYEE } });
    await prisma.attendanceLog.create({ data: { employeeId: users.EMPLOYEE, workDate: todayVN(), checkTime: new Date(), type: "IN", source: "KIOSK", matchScore: 0.02 } });
    await prisma.auditLog.create({ data: { action: "SCAN_SPOOF_REJECTED", entity: "KioskDevice", entityId: "0", detail: JSON.stringify({ tag }) } });
    const page = await (await as("MANAGER", "attendance/suspicious")).json();
    expect(JSON.stringify(page.lowMargin)).toContain(own.code);
    expect(page.events).toEqual([]);
    const admin = await (await as("ADMIN", "attendance/suspicious")).json();
    expect(admin.events.length).toBeGreaterThan(0);
    const dash = await (await as("MANAGER", "dashboard")).json();
    expect(dash.suspicious24h).toBe(0);
  });
  it("deactivating a manager with an invalid shift keeps the department assignment (atomic)", async () => {
    const id = await createFixture("MANAGER");
    const target = await prisma.department.create({ data: { name: `${tag} atomic deactivate`, managerId: id } });
    const res = await employee("ADMIN", id, "PATCH", { active: false, defaultShiftId: missing });
    expect.soft(res.status).toBe(400);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: target.id } })).managerId).toBe(id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).active).toBe(true);
    // A valid deactivation removes the manager together with the profile update.
    expect((await employee("ADMIN", id, "PATCH", { active: false })).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: target.id } })).managerId).toBeNull();
  });
  it("manager with org.manage: weight GET is scoped; a mixed PUT is rejected before any write", async () => {
    const m = defaults(); m.MANAGER.push("org.manage"); await saveMatrix(m);
    await prisma.departmentShiftWeight.upsert({
      where: { departmentId_shiftId: { departmentId: deptB, shiftId } }, create: { departmentId: deptB, shiftId, workDayValue: 0.5 }, update: { workDayValue: 0.5 },
    });
    const list = await (await as("MANAGER", "shift-weights")).json();
    expect(list.weights.some((w: { departmentId: number }) => w.departmentId === deptB)).toBe(false);
    const res = await as("MANAGER", "shift-weights", "PUT", { weights: [{ departmentId: deptA, shiftId, workDayValue: 2 }, { departmentId: deptB, shiftId, workDayValue: 2 }] });
    expect(res.status).toBe(403);
    expect(await prisma.departmentShiftWeight.findFirst({ where: { departmentId: deptA, shiftId } })).toBeNull();
    expect((await as("MANAGER", "shift-weights", "PUT", { weights: [{ departmentId: deptA, shiftId, workDayValue: 2 }] })).status).toBe(200);
    expect((await prisma.departmentShiftWeight.findFirstOrThrow({ where: { departmentId: deptA, shiftId } })).workDayValue).toBe(2);
  });
  it("copy-week: forbidden departmentId plus employeeIds reveals nothing about the other department", async () => {
    const foreign = await prisma.employee.findUniqueOrThrow({ where: { id: outsider } });
    const week = addDays(todayVN(), 7);
    const res = await as("MANAGER", "roster/copy-week", "POST", { fromWeek: todayVN(), toWeek: week, departmentId: deptB, employeeIds: [outsider] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain(foreign.code);
  });
});
