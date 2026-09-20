/// <reference types="vite/client" />
/** Mục "Thông tin" (thư viện liên kết, v1.5.0): quyền links.manage, phạm vi phòng của Quản lý, lọc hiển thị theo vai trò + phòng. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_MATRIX, invalidatePermissionCache, saveMatrix } from "@/lib/permissions";
import { ctx, req, sessionCookie } from "./helpers";

type Handler = (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>;
const modules = import.meta.glob<Record<string, Handler>>("../../src/app/api/**/route.ts", { eager: true });
const tag = `IL${randomUUID().slice(0, 8)}`.toUpperCase();
let seq = 0;
let deptA: number, deptB: number, shiftId: number;
type Who = "ADMIN" | "HR" | "MANAGER" | "EMP_A" | "EMP_B" | "MGR_B";
const users = {} as Record<Who, number>;
const cookies = {} as Record<Who, string>;
let savedPermissions: { role: string; capability: string }[];
const defaults = () => ({ HR: [...DEFAULT_MATRIX.HR], MANAGER: [...DEFAULT_MATRIX.MANAGER], EMPLOYEE: [...DEFAULT_MATRIX.EMPLOYEE] });
const managerGranted = () => ({ ...defaults(), MANAGER: [...DEFAULT_MATRIX.MANAGER, "links.manage"] });

async function call(path: string, method = "GET", cookie?: string, body?: unknown, params: Record<string, string> = {}) {
  const handler = modules[`../../src/app/api/${path}/route.ts`]?.[method];
  if (!handler) throw new Error(`No handler: ${method} ${path}`);
  return handler(req(`/api/${path}`, { method, cookie, body }), ctx(params));
}
const as = (who: Who, path: string, method = "GET", body?: unknown, params?: Record<string, string>) => call(path, method, cookies[who], body, params);
const link = (who: Who, id: number, method: string, body?: unknown) => as(who, "links/[id]", method, body, { id: String(id) });
const valid = (over: Record<string, unknown> = {}) => ({ title: `${tag} link`, url: "https://docs.google.com/spreadsheets/d/abc", icon: "table", color: "amber", ...over });
async function myLinks(who: Who) {
  const r = await as(who, "me/links");
  expect(r.status).toBe(200);
  return (await r.json()) as { links: { id: number; title: string; url: string; icon: string; color: string }[]; canManage: boolean };
}

async function createFixture(role: string, departmentId: number) {
  const e = await prisma.employee.create({ data: {
    code: `${tag}${++seq}`, name: `${tag} ${role}`, phone: `09${randomInt(100000000).toString().padStart(8, "0")}`,
    passwordHash: await bcrypt.hash("Fixture123", 4), role, departmentId, defaultShiftId: shiftId, mustChangePassword: false,
  } });
  return e.id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  savedPermissions = await prisma.rolePermission.findMany();
  await saveMatrix(defaults());
  shiftId = (await prisma.shift.create({ data: { name: `${tag} shift`, startTime: "08:00", endTime: "17:00", breakMinutes: 60 } })).id;
  deptA = (await prisma.department.create({ data: { name: `${tag} A` } })).id;
  deptB = (await prisma.department.create({ data: { name: `${tag} B` } })).id;
  users.ADMIN = await createFixture("ADMIN", deptA);
  users.HR = await createFixture("HR", deptA);
  users.MANAGER = await createFixture("MANAGER", deptA);
  users.MGR_B = await createFixture("MANAGER", deptB);
  users.EMP_A = await createFixture("EMPLOYEE", deptA);
  users.EMP_B = await createFixture("EMPLOYEE", deptB);
  await prisma.department.update({ where: { id: deptA }, data: { managerId: users.MANAGER } });
  await prisma.department.update({ where: { id: deptB }, data: { managerId: users.MGR_B } });
  for (const who of Object.keys(users) as Who[]) cookies[who] = await sessionCookie(users[who]);
});

afterEach(async () => {
  await saveMatrix(defaults());
  await prisma.infoLink.deleteMany({ where: { title: { startsWith: tag } } });
});
afterAll(async () => {
  const ids = Object.values(users);
  await prisma.department.updateMany({ where: { managerId: { in: ids } }, data: { managerId: null } });
  await prisma.auditLog.deleteMany({ where: { entity: "InfoLink", actorId: { in: ids } } });
  await prisma.notificationLog.deleteMany({ where: { toEmployeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.department.deleteMany({ where: { id: { in: [deptA, deptB] } } });
  await prisma.shift.deleteMany({ where: { id: shiftId } });
  await prisma.$transaction([prisma.rolePermission.deleteMany(), prisma.rolePermission.createMany({ data: savedPermissions })]);
  invalidatePermissionCache();
});

describe("links.manage: ai được tạo / sửa / xóa", () => {
  it("HR tạo được (201), trả DTO đã chuẩn hóa; ghi audit INFOLINK_UPDATE", async () => {
    const before = await prisma.auditLog.count({ where: { action: "INFOLINK_UPDATE" } });
    const r = await as("HR", "links", "POST", valid({ visibleDeptIds: [deptA, deptA], visibleRoles: ["EMPLOYEE", "EMPLOYEE"] }));
    const text = await r.text();
    expect(r.status, text).toBe(201);
    const { link: l } = JSON.parse(text);
    expect(l).toMatchObject({ title: `${tag} link`, icon: "table", color: "amber", active: true, order: 0, visibleDeptIds: [deptA], visibleRoles: ["EMPLOYEE"] });
    expect(await prisma.auditLog.count({ where: { action: "INFOLINK_UPDATE" } })).toBe(before + 1);
  });
  it("ADMIN luôn tạo được; EMPLOYEE và MANAGER (mặc định) bị 403", async () => {
    expect((await as("ADMIN", "links", "POST", valid())).status).toBe(201);
    expect((await as("EMP_A", "links", "POST", valid())).status).toBe(403);
    expect((await as("MANAGER", "links", "POST", valid())).status).toBe(403);
    expect((await as("MANAGER", "links")).status).toBe(403);
    expect(await prisma.infoLink.count({ where: { title: { startsWith: tag } } })).toBe(1);
  });
  it("Quản lý được cấp quyền: phải chọn phòng mình; phòng khác hoặc toàn công ty bị 403", async () => {
    await saveMatrix(managerGranted());
    expect((await as("MANAGER", "links", "POST", valid())).status).toBe(403); // toàn công ty
    expect((await as("MANAGER", "links", "POST", valid({ visibleDeptIds: [deptB] }))).status).toBe(403);
    expect((await as("MANAGER", "links", "POST", valid({ visibleDeptIds: [deptA, deptB] }))).status).toBe(403);
    const ok = await as("MANAGER", "links", "POST", valid({ visibleDeptIds: [deptA] }));
    const okText = await ok.text();
    expect(ok.status, okText).toBe(201);
    const { link: mine } = JSON.parse(okText);
    // Không được mở rộng sang phòng khác hay xóa hết phòng khi sửa.
    expect((await link("MANAGER", mine.id, "PATCH", { visibleDeptIds: [deptA, deptB] })).status).toBe(403);
    expect((await link("MANAGER", mine.id, "PATCH", { visibleDeptIds: [] })).status).toBe(403);
    expect((await link("MANAGER", mine.id, "PATCH", { title: `${tag} renamed` })).status).toBe(200);
    expect((await prisma.infoLink.findUnique({ where: { id: mine.id } }))?.visibleDeptIds).toBe(JSON.stringify([deptA]));
  });
  it("PATCH một trường không làm mất các trường khác (hồi quy: .partial() của zod 4 vẫn áp default)", async () => {
    const created = JSON.parse(await (await as("HR", "links", "POST", valid({ visibleDeptIds: [deptA], visibleRoles: ["MANAGER"], order: 7, active: false, description: "giữ" }))).text()).link;
    expect((await link("HR", created.id, "PATCH", { title: `${tag} chỉ đổi tên` })).status).toBe(200);
    const row = await prisma.infoLink.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ title: `${tag} chỉ đổi tên`, icon: "table", color: "amber", order: 7, active: false, description: "giữ", visibleRoles: JSON.stringify(["MANAGER"]), visibleDeptIds: JSON.stringify([deptA]) });
  });
  it("Quản lý không chạm được liên kết toàn công ty hay của phòng khác; GET chỉ trả liên kết trong phạm vi", async () => {
    const global = (await (await as("HR", "links", "POST", valid({ title: `${tag} global` }))).json()).link;
    const other = (await (await as("HR", "links", "POST", valid({ title: `${tag} other`, visibleDeptIds: [deptB] }))).json()).link;
    const mine = (await (await as("HR", "links", "POST", valid({ title: `${tag} mine`, visibleDeptIds: [deptA] }))).json()).link;
    await saveMatrix(managerGranted());
    expect((await link("MANAGER", global.id, "PATCH", { title: `${tag} hijack` })).status).toBe(403);
    expect((await link("MANAGER", other.id, "DELETE")).status).toBe(403);
    expect((await link("MANAGER", 2147483647, "DELETE")).status).toBe(404);
    const listed = (await (await as("MANAGER", "links")).json()).links.map((l: { id: number }) => l.id);
    expect(listed).toContain(mine.id);
    expect(listed).not.toContain(global.id);
    expect(listed).not.toContain(other.id);
    expect((await link("MANAGER", mine.id, "DELETE")).status).toBe(200);
    expect(await prisma.infoLink.count({ where: { id: { in: [global.id, other.id] } } })).toBe(2);
    expect((await link("HR", global.id, "DELETE")).status).toBe(200);
  });
  it("kiểm tra dữ liệu: URL không phải http(s), icon/màu/vai trò lạ, phòng không tồn tại → 400", async () => {
    for (const bad of [
      { url: "javascript:alert(1)" },
      { url: "ftp://x.y" },
      { url: "docs.google.com/abc" },
      { icon: "not-an-icon" },
      { color: "pink" },
      { visibleRoles: ["BOSS"] },
      { visibleDeptIds: [2147483647] },
      { title: "a" },
    ]) {
      const r = await as("HR", "links", "POST", valid(bad));
      expect(r.status, JSON.stringify(bad) + (await r.text())).toBe(400);
    }
    expect(await prisma.infoLink.count({ where: { title: { startsWith: tag } } })).toBe(0);
  });
});

describe("GET /api/me/links: lọc theo vai trò + phòng ban", () => {
  it("giao của phòng và vai trò; rỗng = tất cả; ẩn thì không thấy; sắp theo thứ tự", async () => {
    const mk = (over: Record<string, unknown>) => as("HR", "links", "POST", valid(over));
    await mk({ title: `${tag} 3 all`, order: 3 });
    await mk({ title: `${tag} 1 deptA`, order: 1, visibleDeptIds: [deptA] });
    await mk({ title: `${tag} 2 managers`, order: 2, visibleRoles: ["MANAGER"] });
    await mk({ title: `${tag} 4 mgrB`, order: 4, visibleRoles: ["MANAGER"], visibleDeptIds: [deptB] });
    await mk({ title: `${tag} 0 hidden`, order: 0, active: false });

    // DB test có sẵn liên kết mẫu từ seed → chỉ xét liên kết của file này.
    const titles = async (who: Who) => (await myLinks(who)).links.filter((l) => l.title.startsWith(tag)).map((l) => l.title.replace(`${tag} `, ""));
    expect(await titles("EMP_A")).toEqual(["1 deptA", "3 all"]);
    expect(await titles("EMP_B")).toEqual(["3 all"]);
    expect(await titles("MANAGER")).toEqual(["1 deptA", "2 managers", "3 all"]);
    expect(await titles("MGR_B")).toEqual(["2 managers", "3 all", "4 mgrB"]);
    // HR ở phòng A: không phải MANAGER nên không thấy "2 managers"; ADMIN cũng theo đúng luật.
    expect(await titles("HR")).toEqual(["1 deptA", "3 all"]);
    expect(await titles("ADMIN")).toEqual(["1 deptA", "3 all"]);
  });
  it("chỉ trả trường cần hiển thị + cờ canManage; nhân viên không thấy danh sách phòng/vai trò", async () => {
    await as("HR", "links", "POST", valid({ description: "mô tả" }));
    const r = await myLinks("EMP_A");
    const l = r.links.find((x) => x.title === `${tag} link`)!;
    expect(Object.keys(l).sort()).toEqual(["color", "description", "icon", "id", "title", "url"]);
    expect(r.canManage).toBe(false);
    expect((await myLinks("HR")).canManage).toBe(true);
    expect((await myLinks("MANAGER")).canManage).toBe(false);
    await saveMatrix(managerGranted());
    expect((await myLinks("MANAGER")).canManage).toBe(true);
  });
  it("PATCH active=false ẩn ngay; bật lại thì thấy", async () => {
    const { link: l } = await (await as("HR", "links", "POST", valid())).json();
    expect((await myLinks("EMP_B")).links.some((x) => x.id === l.id)).toBe(true);
    expect((await link("HR", l.id, "PATCH", { active: false })).status).toBe(200);
    expect((await myLinks("EMP_B")).links.some((x) => x.id === l.id)).toBe(false);
    expect((await link("HR", l.id, "PATCH", { active: true, icon: "folder", color: "sky" })).status).toBe(200);
    const again = (await myLinks("EMP_B")).links.find((x) => x.id === l.id)!;
    expect(again).toMatchObject({ icon: "folder", color: "sky" });
  });
  it("chưa đăng nhập → 401", async () => {
    expect((await call("me/links")).status).toBe(401);
  });
});
