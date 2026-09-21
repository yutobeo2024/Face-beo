// v1.8.0: thông tin cá nhân (CCCD, ngày sinh, giới tính, địa chỉ), SĐT không bắt buộc, quyền xem.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { invalidatePermissionCache } from "@/lib/permissions";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as overviewRoute from "@/app/api/me/overview/route";
import * as loginRoute from "@/app/api/auth/login/route";

type E = Awaited<ReturnType<typeof byCode>>;
let hr: E, mgr: E;
let H: string, M: string;
const tag = `P${Date.now().toString().slice(-6)}`;
const codes = [`${tag}A`, `${tag}B`, `${tag}C`];

beforeAll(async () => {
  [hr, mgr] = await Promise.all(["NV016", "NV003"].map(byCode)); // NV003: quản lý phòng Kinh doanh
  [H, M] = await Promise.all([hr, mgr].map((e) => sessionCookie(e.id)));
});
afterAll(async () => {
  const ids = (await prisma.employee.findMany({ where: { code: { in: codes } }, select: { id: true } })).map((e) => e.id);
  await prisma.scheduleAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
});

const create = (cookie: string, body: Record<string, unknown>) =>
  employeesRoute.POST(req("/api/employees", { method: "POST", cookie, body: { role: "EMPLOYEE", departmentId: mgr.departmentId, defaultShiftId: mgr.defaultShiftId, ...body } }), ctx());

describe("SĐT không bắt buộc, trường cá nhân mới", () => {
  it("tạo 2 người không SĐT không xung đột; người không SĐT đăng nhập bằng mã", async () => {
    const r1 = await create(H, { code: codes[0], name: "Không Số Một", phone: "" });
    expect(r1.status).toBe(201);
    const { tempPassword } = await r1.json();
    expect((await create(H, { code: codes[1], name: "Không Số Hai" })).status).toBe(201);
    expect((await prisma.employee.findUniqueOrThrow({ where: { code: codes[0] } })).phone).toBeNull();
    resetRateLimits();
    const login = await loginRoute.POST(req("/api/auth/login", { method: "POST", body: { login: codes[0], password: tempPassword } }), ctx());
    expect(login.status).toBe(200);
  });

  it("CCCD / ngày sinh / giới tính / địa chỉ: kiểm định dạng, CCCD không trùng; mã trùng vẫn báo đúng", async () => {
    expect((await create(H, { code: codes[2], name: "Có CCCD", nationalId: "123" })).status).toBe(400);
    expect((await create(H, { code: codes[2], name: "Có CCCD", dateOfBirth: "2030-01-01" })).status).toBe(400);
    expect((await create(H, { code: codes[2], name: "Có CCCD", gender: "X" })).status).toBe(400);
    const ok = await create(H, { code: codes[2], name: "Có CCCD", nationalId: "079190000999", dateOfBirth: "1990-03-05", gender: "NU", address: "12 Lê Lợi" });
    expect(ok.status).toBe(201);
    const dup = await create(H, { code: `${tag}D`, name: "Trùng CCCD", nationalId: "079190000999" });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toContain("CCCD");
    expect((await create(H, { code: codes[2], name: "Trùng mã" })).status).toBe(400);
    // Sửa: trùng CCCD người khác → 400; xóa CCCD (chuỗi rỗng) → null.
    const b = await prisma.employee.findUniqueOrThrow({ where: { code: codes[1] } });
    const patch = (body: unknown) => employeeRoute.PATCH(req(`/api/employees/${b.id}`, { method: "PATCH", cookie: H, body }), ctx({ id: String(b.id) }));
    expect((await patch({ nationalId: "079190000999" })).status).toBe(400);
    expect((await patch({ nationalId: "079190000888" })).status).toBe(200);
    expect((await patch({ nationalId: "" })).status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: b.id } })).nationalId).toBeNull();
  });

  it("nhật ký không chứa số CCCD / địa chỉ", async () => {
    const c = await prisma.employee.findUniqueOrThrow({ where: { code: codes[2] } });
    const patch = await employeeRoute.PATCH(req(`/api/employees/${c.id}`, { method: "PATCH", cookie: H, body: { address: "99 Nguyễn Huệ bí mật" } }), ctx({ id: String(c.id) }));
    expect(patch.status).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { entityId: String(c.id), entity: "Employee" } });
    for (const l of logs) {
      expect(l.detail ?? "").not.toContain("079190000999");
      expect(l.detail ?? "").not.toContain("bí mật");
    }
    const zalo = await prisma.notificationLog.findMany({ where: { payload: { contains: "bí mật" } } });
    expect(zalo).toHaveLength(0);
  });
});

describe("quyền xem thông tin cá nhân", () => {
  it("Nhân sự thấy; Quản lý không thấy (kể cả SĐT); chính chủ thấy ở trang cá nhân", async () => {
    const c = await prisma.employee.findUniqueOrThrow({ where: { code: codes[2] } });
    const rowFor = async (cookie: string) =>
      (await (await employeesRoute.GET(req(`/api/employees?q=${codes[2]}`, { cookie }), ctx())).json()).employees.find((e: { id: number }) => e.id === c.id);
    expect(await rowFor(H)).toMatchObject({ nationalId: "079190000999", dateOfBirth: "1990-03-05", gender: "NU" });
    const m = await rowFor(M);
    expect(m).toBeDefined();
    for (const k of ["nationalId", "dateOfBirth", "gender", "address", "phone"]) expect(m[k]).toBeUndefined();
    const detail = await (await employeeRoute.GET(req(`/api/employees/${c.id}`, { cookie: M }), ctx({ id: String(c.id) }))).json();
    expect(detail.employee.nationalId).toBeUndefined();
    const me = await (await overviewRoute.GET(req("/api/me/overview", { cookie: await sessionCookie(c.id) }), ctx())).json();
    expect(me.me).toMatchObject({ nationalId: "079190000999", dateOfBirth: "1990-03-05", gender: "NU" });
  });

  it("Quản lý được cấp quyền quản lý nhân viên vẫn KHÔNG thấy / không sửa được thông tin cá nhân người khác", async () => {
    const c = await prisma.employee.findUniqueOrThrow({ where: { code: codes[2] } });
    await prisma.rolePermission.upsert({ where: { role_capability: { role: "MANAGER", capability: "employees.manage" } }, create: { role: "MANAGER", capability: "employees.manage" }, update: {} });
    invalidatePermissionCache();
    try {
      const list = await (await employeesRoute.GET(req(`/api/employees?q=${codes[2]}`, { cookie: M }), ctx())).json();
      expect(list.employees.find((e: { id: number }) => e.id === c.id)?.nationalId).toBeUndefined();
      // Gửi chuỗi rỗng (form không có ô) không được xóa CCCD; gửi giá trị mới cũng bị bỏ qua.
      const patch = await employeeRoute.PATCH(req(`/api/employees/${c.id}`, { method: "PATCH", cookie: M, body: { nationalId: "", address: "Sửa trộm" } }), ctx({ id: String(c.id) }));
      expect(patch.status).toBe(200);
      expect(await prisma.employee.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ nationalId: "079190000999" });
      expect((await prisma.employee.findUniqueOrThrow({ where: { id: c.id } })).address).not.toBe("Sửa trộm");
    } finally {
      await prisma.rolePermission.deleteMany({ where: { role: "MANAGER", capability: "employees.manage" } });
      invalidatePermissionCache();
    }
  });
});
