/// <reference types="vite/client" />
/**
 * Fixture dùng chung cho test phân hệ Công việc (v1.23.0): phòng + ca + người dùng gắn tag, gọi thẳng route handler,
 * khôi phục ma trận quyền + dọn sạch dữ liệu trong afterAll.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_MATRIX, invalidatePermissionCache, saveMatrix } from "@/lib/permissions";
import { ctx, req, sessionCookie } from "./helpers";

type Handler = (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>;
const modules = import.meta.glob<Record<string, Handler>>("../../src/app/api/**/route.ts", { eager: true });

export type Who = "ADMIN" | "HR" | "MGR" | "E1" | "E2" | "E3" | "E4";
export const defaults = () => ({ HR: [...DEFAULT_MATRIX.HR], MANAGER: [...DEFAULT_MATRIX.MANAGER], EMPLOYEE: [...DEFAULT_MATRIX.EMPLOYEE] });

export function setupTasksFixture(prefix: string) {
  const tag = `${prefix}${randomUUID().slice(0, 6)}`.toUpperCase();
  const users = {} as Record<Who, number>;
  const codes = {} as Record<Who, string>;
  const cookies = {} as Record<Who, string>;
  const groupId = `${tag}-grp`;
  let saved: { role: string; capability: string }[] = [];
  let deptId = 0;
  let shiftId = 0;

  async function call(path: string, method = "GET", cookie?: string, body?: unknown, params: Record<string, string> = {}) {
    const handler = modules[`../../src/app/api/${path}/route.ts`]?.[method];
    if (!handler) throw new Error(`No handler: ${method} ${path}`);
    const q = method === "GET" && body && typeof body === "object" ? `?${new URLSearchParams(body as Record<string, string>)}` : "";
    return handler(req(`/api/${path}${q}`, { method, cookie, body: method === "GET" ? undefined : body }), ctx(params));
  }
  const as = (who: Who, path: string, method = "GET", body?: unknown, params?: Record<string, string>) => call(path, method, cookies[who], body, params);
  const ok = async <T = Record<string, unknown>>(res: Response | Promise<Response>, status = 200): Promise<T> => {
    const r = await res;
    const text = await r.text();
    expect(r.status, text).toBe(status);
    return JSON.parse(text) as T;
  };

  /** Tạo dự án qua API (người tạo = Chủ dự án) và thêm thành viên. */
  async function project(owner: Who, members: Partial<Record<Who, "ADMIN" | "MEMBER" | "CONTRIBUTOR">> = {}, extra: Record<string, unknown> = {}) {
    const { project } = await ok<{ project: { id: number } }>(as(owner, "tasks/projects", "POST", { name: `${tag} dự án`, ...extra }), 201);
    const list = Object.entries(members).map(([who, role]) => ({ employeeId: users[who as Who], role }));
    if (list.length) await ok(as(owner, "tasks/projects/[id]/members", "PUT", { members: list }, { id: String(project.id) }));
    return project.id;
  }

  async function task(who: Who, projectId: number, body: Record<string, unknown> = {}) {
    const { task } = await ok<{ task: { id: number; status: string } }>(
      as(who, "tasks/projects/[id]/tasks", "POST", { title: `${tag} việc`, dueAt: "2030-01-10T10:00:00.000Z", ...body }, { id: String(projectId) }),
      201,
    );
    return task;
  }

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
    saved = await prisma.rolePermission.findMany();
    await saveMatrix(defaults());
    shiftId = (await prisma.shift.create({ data: { name: `${tag} ca`, startTime: "08:00", endTime: "17:00", breakMinutes: 60 } })).id;
    deptId = (await prisma.department.create({ data: { name: `${tag} phòng` } })).id;
    const roles: Record<Who, string> = { ADMIN: "ADMIN", HR: "HR", MGR: "MANAGER", E1: "EMPLOYEE", E2: "EMPLOYEE", E3: "EMPLOYEE", E4: "EMPLOYEE" };
    for (const [who, role] of Object.entries(roles) as [Who, string][]) {
      const e = await prisma.employee.create({
        data: {
          code: `${tag}${who}`,
          name: `${tag} ${who}`,
          phone: `09${randomInt(100000000).toString().padStart(8, "0")}`,
          passwordHash: await bcrypt.hash("Fixture123", 4),
          role,
          departmentId: deptId,
          defaultShiftId: shiftId,
          mustChangePassword: false,
        },
      });
      users[who] = e.id;
      codes[who] = e.code;
      cookies[who] = await sessionCookie(e.id);
    }
    await prisma.zaloGroup.create({ data: { groupId, name: `${tag} nhóm`, source: "MANUAL" } });
  });

  afterAll(async () => {
    const ids = Object.values(users);
    await prisma.project.deleteMany({ where: { OR: [{ createdById: { in: ids } }, { ownerId: { in: ids } }] } });
    await prisma.notificationLog.deleteMany({ where: { OR: [{ toEmployeeId: { in: ids } }, { toGroupId: groupId }] } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.zaloGroup.deleteMany({ where: { groupId } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.$transaction([prisma.rolePermission.deleteMany(), prisma.rolePermission.createMany({ data: saved })]);
    invalidatePermissionCache();
  });

  return { tag, users, codes, cookies, groupId, call, as, ok, project, task };
}
