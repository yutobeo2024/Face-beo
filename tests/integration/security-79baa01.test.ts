/** Security reproductions: passing PoCs CONFIRM vulnerable behavior, not security.
 * SECURITY_STRICT=1 asserts desired defenses instead, so confirmed findings fail.
 * No application fixes; isolated fixtures, real route handlers and test database.
 */
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { signSession, verifySession } from "@/lib/session";
import { encryptDescriptor, decryptDescriptor } from "@/lib/crypto";
import { decodeJpegDataUrl, readSnapshot, saveSnapshot, snapshotDir } from "@/lib/storage";
import { evaluateLiveness, registerServerLiveness } from "@/lib/liveness";
import { getMatrix, saveMatrix, EDITABLE_ROLES } from "@/lib/permissions";
import { GET as snapshot } from "@/app/api/snapshots/[...path]/route";
import { SESSION_COOKIE } from "@/lib/roles";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as createEmployee } from "@/app/api/employees/route";
import { GET as employeeDetail, PATCH as patchEmployee } from "@/app/api/employees/[id]/route";
import { GET as holidays } from "@/app/api/holidays/route";
import { POST as webhook } from "@/app/api/zalo/webhook/route";
import { req, ctx } from "./helpers";

// Đã khắc phục ở v1.4.4: luôn kiểm tra hành vi an toàn (trước đây chỉ khi SECURITY_STRICT=1, chế độ PoC tái hiện lỗi cũ).
const strict = true;
const tag = `SEC${randomUUID().replaceAll("-", "").slice(0, 8)}`.toUpperCase();
const ids: number[] = [];
let departmentId: number;
let shiftId: number;
let adminId: number;
let adminCookie: string;
let phoneCounter = 0;
const originalPassword = "OriginalPass123";

async function fixture(role: "ADMIN" | "EMPLOYEE" = "EMPLOYEE") {
  const e = await prisma.employee.create({ data: {
    code: `${tag}${++phoneCounter}`, name: `${tag} fixture`,
    phone: `09${String(Date.now() % 1000000).padStart(6, "0")}${String(phoneCounter).padStart(2, "0")}`,
    role, departmentId, defaultShiftId: shiftId,
    passwordHash: await bcrypt.hash(originalPassword, 10), mustChangePassword: false,
  } });
  ids.push(e.id);
  return e;
}
async function cookie(id: number, role: "ADMIN" | "EMPLOYEE" = "EMPLOYEE") {
  return `${SESSION_COOKIE}=${await signSession({ sub: String(id), role, name: tag, mcp: false })}`;
}
async function logIn(code: string, password: string) {
  return login(req("/api/auth/login", { method: "POST", body: { login: code, password },
    headers: { "x-forwarded-for": `security-${randomUUID()}` } }), ctx());
}
const authenticatedRead = (c: string) => holidays(req("/api/holidays", { cookie: c }), ctx());

beforeAll(async () => {
  if (process.env.DATABASE_URL !== "file:../data/test.db" || process.env.DISABLE_CRON !== "true") {
    throw new Error("Security tests must use isolated test DB with cron disabled");
  }
  // No outgoing network, even if a future fixture accidentally enables an integration.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in security audit"); }));
  departmentId = (await prisma.department.create({ data: { name: tag } })).id;
  shiftId = (await prisma.shift.create({ data: { name: tag, startTime: "08:00", endTime: "17:00" } })).id;
  const admin = await fixture("ADMIN");
  adminId = admin.id;
  adminCookie = await cookie(admin.id, "ADMIN");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); registerServerLiveness(null); });
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.notificationLog.deleteMany({ where: { OR: [{ toEmployeeId: { in: ids } }, { payload: { contains: tag } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entity: "Employee", entityId: { in: ids.map(String) } }] } });
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  if (departmentId) await prisma.department.delete({ where: { id: departmentId } });
  if (shiftId) await prisma.shift.delete({ where: { id: shiftId } });
});

it("SEC-01 PoC: omitted creation password permits first-login account takeover", async () => {
  const code = `${tag}NEW`;
  const created = await createEmployee(req("/api/employees", { method: "POST", cookie: adminCookie,
    body: { code, name: `${tag} new employee`, phone: "0981234567", role: "EMPLOYEE", departmentId, defaultShiftId: shiftId },
  }), ctx());
  expect(created.status).toBe(201);
  ids.push((await created.json()).employee.id);
  const initial = await logIn(code, "123456");
  expect(initial.status).toBe(strict ? 401 : 200);
  // Đã sửa: tài khoản mới nhận mật khẩu tạm ngẫu nhiên (trả về một lần cho người tạo), không còn mật khẩu mặc định để chiếm.
  if (strict) {
    const { tempPassword } = await createEmployee(req("/api/employees", { method: "POST", cookie: adminCookie,
      body: { code: `${code}2`, name: `${tag} new employee 2`, phone: "0981234568", role: "EMPLOYEE", departmentId, defaultShiftId: shiftId },
    }), ctx()).then((r) => r.json());
    ids.push((await prisma.employee.findUniqueOrThrow({ where: { code: `${code}2` } })).id);
    expect(typeof tempPassword).toBe("string");
    expect(tempPassword).not.toBe("123456");
    expect((await logIn(`${code}2`, tempPassword)).status).toBe(200);
    return;
  }
  const stolen = initial.headers.get("set-cookie")!.split(";")[0];
  expect((await authenticatedRead(stolen)).status).toBe(403);
  const changed = await changePassword(req("/api/auth/change-password", { method: "POST", cookie: stolen,
    body: { currentPassword: "123456", newPassword: "AttackerChosen123" } }), ctx());
  expect(changed.status).toBe(200);
  expect((await authenticatedRead(changed.headers.get("set-cookie")!.split(";")[0])).status).toBe(200);
});

it("SEC-02a PoC: pre-change session remains usable after password change", async () => {
  const e = await fixture();
  const old = await cookie(e.id);
  const result = await changePassword(req("/api/auth/change-password", { method: "POST", cookie: old,
    body: { currentPassword: originalPassword, newPassword: "NewPassword123" } }), ctx());
  expect(result.status).toBe(200);
  expect((await authenticatedRead(old)).status).toBe(strict ? 401 : 200);
});

it("SEC-02b PoC: logout deletes browser cookie but does not revoke copied token", async () => {
  const e = await fixture();
  const old = await cookie(e.id);
  const result = await logout(req("/api/auth/logout", { method: "POST", cookie: old }), ctx());
  expect(result.status).toBe(200);
  expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await authenticatedRead(old)).status).toBe(strict ? 401 : 200);
});

it("SEC-02c PoC: stolen session revives after admin reset and legitimate password change", async () => {
  const e = await fixture();
  const old = await cookie(e.id);
  const reset = await patchEmployee(req(`/api/employees/${e.id}`, { method: "PATCH", cookie: adminCookie,
    body: { resetPassword: true } }), ctx({ id: String(e.id) }));
  expect(reset.status).toBe(200);
  const { tempPassword } = await reset.json();
  expect([401, 403]).toContain((await authenticatedRead(old)).status);
  const legitimate = await logIn(e.code, tempPassword);
  expect(legitimate.status).toBe(200);
  const changed = await changePassword(req("/api/auth/change-password", { method: "POST",
    cookie: legitimate.headers.get("set-cookie")!.split(";")[0],
    body: { currentPassword: tempPassword, newPassword: "LegitimateNew123" } }), ctx());
  expect(changed.status).toBe(200);
  expect((await authenticatedRead(old)).status).toBe(strict ? 401 : 200);
});

it("SEC-03 PoC: wrong-password response enumerates active employee accounts", async () => {
  const e = await fixture();
  const existing = await logIn(e.code, "WrongPassword123");
  const missing = await logIn(`${tag}MISSING`, "WrongPassword123");
  expect(existing.status).toBe(401);
  expect(missing.status).toBe(401);
  const a = (await existing.json()).error;
  const b = (await missing.json()).error;
  expect(a === b).toBe(strict);
});

it("SEC-04 PoC: concurrent wrong passwords lose lockout increments (controlled interleaving)", async () => {
  const e = await fixture();
  const realCompare = bcrypt.compare.bind(bcrypt);
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  // Delay only real password verification until all 5 handlers have read the same DB state.
  // No fabricated DB response or password result; timeout prevents a hanging regression.
  const timer = setTimeout(release, 3000);
  vi.spyOn(bcrypt, "compare").mockImplementation((async (password: string, hash: string) => {
    if (++arrived === 5) release();
    await barrier;
    return realCompare(password, hash);
  }) as typeof bcrypt.compare);
  let responses: Response[];
  try { responses = await Promise.all(Array.from({ length: 5 }, () => logIn(e.code, "WrongPassword123"))); }
  finally { clearTimeout(timer); }
  expect(arrived).toBe(5);
  const row = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
  if (strict) {
    expect(row.lockedUntil).not.toBeNull();
  } else {
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(row.failedLogins).toBe(1);
    expect(row.lockedUntil).toBeNull();
  }
});

it("SEC-05 PoC: delegated employee can read unscoped rejected-scan snapshot if URL is known", async () => {
  const e = await fixture();
  const employeeCookie = await cookie(e.id);
  const previous = await getMatrix();
  const saved = Object.fromEntries(EDITABLE_ROLES.map((role) => [role, [...previous[role]]])) as Record<(typeof EDITABLE_ROLES)[number], string[]>;
  // Four-byte test fixture, not personal data. No AttendanceLog: same storage shape as a rejected scan.
  const url = await saveSnapshot(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const parts = url.replace("/api/snapshots/", "").split("/");
  try {
    await saveMatrix({ ...saved, EMPLOYEE: ["snapshots.view", "suspicious.view"] });
    const response = await snapshot(req(url, { cookie: employeeCookie }), ctx({ path: parts }));
    expect(response.status).toBe(strict ? 403 : 200);
    if (!strict) expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  } finally {
    await saveMatrix(saved);
    await unlink(join(snapshotDir(), ...parts));
  }
});

it("SEC-06a PoC: L1-only decision trusts client-supplied liveness scores", async () => {
  vi.stubEnv("LIVENESS_SERVER", "false");
  const result = await evaluateLiveness({ frames: Array.from({ length: 3 }, () => ({ real: 1, live: 1 })),
    threshold: 0.8, serverThreshold: 0.8, snapshot: Buffer.from("not an image") });
  expect(result.server.status).toBe("disabled");
  // Chấp nhận có chủ đích: L2 TẮT là lựa chọn cấu hình (máy không có mô hình); khi đó chỉ có L1. Vận hành thật phải bật LIVENESS_SERVER.
  expect(result.verified).toBe(true);
});

it("SEC-06b PoC: simulated L2 infrastructure failure falls back to client scores", async () => {
  vi.stubEnv("LIVENESS_SERVER", "true");
  registerServerLiveness(async () => { throw new Error("Simulated model unavailable"); });
  const result = await evaluateLiveness({ frames: Array.from({ length: 3 }, () => ({ real: 1, live: 1 })),
    threshold: 0.8, serverThreshold: 0.8, snapshot: Buffer.from("test only"), faceBox: [0, 0, 100, 100] });
  expect(result.server.status).toBe("unavailable");
  expect(result.verified).toBe(!strict);
});

it("control: sequential wrong passwords do lock the account on fifth attempt", async () => {
  const e = await fixture();
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await logIn(e.code, "WrongPassword123")).status);
  expect(statuses).toEqual([401, 401, 401, 401, 423]);
  expect((await logIn(e.code, originalPassword)).status).toBe(423);
});

it("control: deactivated employee is rejected despite previously valid JWT", async () => {
  const e = await fixture();
  const old = await cookie(e.id);
  await prisma.employee.update({ where: { id: e.id }, data: { active: false } });
  expect((await authenticatedRead(old)).status).toBe(401);
});

it("control: claimed ADMIN in signed JWT cannot override database EMPLOYEE role", async () => {
  const e = await fixture();
  const forgedRole = await cookie(e.id, "ADMIN");
  expect((await createEmployee(req("/api/employees", { method: "POST", cookie: forgedRole, body: {} }), ctx())).status).toBe(403);
});

it("control: employee cannot read another employee record by ID", async () => {
  const e = await fixture();
  const result = await employeeDetail(req(`/api/employees/${adminId}`, { cookie: await cookie(e.id) }), ctx({ id: String(adminId) }));
  expect(result.status).toBe(403);
});

it("control: altered JWT signature is rejected", async () => {
  const token = await signSession({ sub: String(adminId), role: "ADMIN", name: tag, mcp: false });
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  expect(await verifySession(parts.join("."))).toBeNull();
});

it("control: configured webhook secret rejects unsigned input even in test mode", async () => {
  vi.stubEnv("ZALO_WEBHOOK_SECRET", "security-test-only-secret");
  const result = await webhook(req("/api/zalo/webhook", { method: "POST", body: { event_name: "create_group", group_id: tag } }), ctx());
  expect(result.status).toBe(401);
  expect(await prisma.zaloGroup.findUnique({ where: { groupId: tag } })).toBeNull();
});

it("control: snapshot traversal is rejected", async () => {
  expect(await readSnapshot(["..", "..", ".env", "secret.jpg"])).toBeNull();
});

it("control: non-JPEG and oversized snapshot payloads are rejected", () => {
  expect(() => decodeJpegDataUrl("data:image/jpeg;base64," + Buffer.from("<script>alert(1)</script>").toString("base64"))).toThrow();
  expect(() => decodeJpegDataUrl("data:image/jpeg;base64," + Buffer.alloc(1024 * 1024 + 1).toString("base64"))).toThrow();
});

it("control: tampered encrypted biometric descriptor fails authentication", () => {
  const encrypted = encryptDescriptor([0.1, 0.2, 0.3]);
  encrypted[encrypted.length - 1] ^= 1;
  expect(() => decryptDescriptor(encrypted)).toThrow();
});
