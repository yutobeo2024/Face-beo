// v1.16.0 (giảm độ trễ trên điện thoại): danh sách nhân viên rút gọn cho ô chọn, bộ nhớ đệm ảnh đại diện, chỉ mục DB.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as employeesRoute from "@/app/api/employees/route";

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

describe("danh sách nhân viên rút gọn (fields=basic)", () => {
  it("chỉ trả id / mã / tên / phòng — KHÔNG kèm dữ liệu cá nhân, ảnh, ca, mẫu tuần", async () => {
    const hr = await byCode("NV016");
    const cookie = await sessionCookie(hr.id);
    const r = await employeesRoute.GET(req("/api/employees?fields=basic", { cookie }), ctx());
    expect(r.status).toBe(200);
    const { employees } = (await r.json()) as { employees: Record<string, unknown>[] };
    expect(employees.length).toBeGreaterThan(0);
    for (const e of employees) {
      expect(Object.keys(e).sort()).toEqual(["active", "code", "departmentId", "id", "name"]);
    }
  });

  it("giữ nguyên phạm vi theo vai trò: Quản lý chỉ thấy phòng mình", async () => {
    const mgr = await byCode("NV003"); // quản lý một phòng
    const cookie = await sessionCookie(mgr.id);
    const r = await employeesRoute.GET(req("/api/employees?fields=basic", { cookie }), ctx());
    expect(r.status).toBe(200);
    const { employees } = (await r.json()) as { employees: { departmentId: number }[] };
    const mine = await prisma.department.findMany({ where: { managerId: mgr.id }, select: { id: true } });
    const allowed = new Set(mine.map((d) => d.id));
    expect(employees.length).toBeGreaterThan(0);
    for (const e of employees) expect(allowed.has(e.departmentId), `phòng ${e.departmentId}`).toBe(true);
  });

  it("lọc theo phòng / tìm theo tên vẫn chạy", async () => {
    const admin = await byCode("NV001");
    const cookie = await sessionCookie(admin.id);
    const target = await byCode("NV008");
    const r = await employeesRoute.GET(req(`/api/employees?fields=basic&q=${encodeURIComponent(target.name.split(" ").at(-1)!)}`, { cookie }), ctx());
    const { employees } = (await r.json()) as { employees: { id: number }[] };
    expect(employees.some((e) => e.id === target.id)).toBe(true);
    const r2 = await employeesRoute.GET(req(`/api/employees?fields=basic&departmentId=${target.departmentId}`, { cookie }), ctx());
    const { employees: byDept } = (await r2.json()) as { employees: { departmentId: number }[] };
    expect(byDept.every((e) => e.departmentId === target.departmentId)).toBe(true);
  });

  it("người không có quyền xem nhân viên vẫn bị chặn", async () => {
    const emp = await byCode("NV009");
    const r = await employeesRoute.GET(req("/api/employees?fields=basic", { cookie: await sessionCookie(emp.id) }), ctx());
    expect(r.status).toBe(403);
  });
});

describe("ảnh đại diện được phép giữ trên máy người dùng", () => {
  const cacheOf = (f: string) => readFileSync(join(process.cwd(), "src", "app", "api", "employees", "[id]", f, "route.ts"), "utf8");
  it("dùng private, max-age (URL đã kèm ?v= nên đổi ảnh là đổi địa chỉ); ảnh khuôn mặt giữ ngắn hơn ảnh tự chọn", () => {
    // Ảnh khuôn mặt = dữ liệu sinh trắc → 60 giây; ảnh tự chọn → 10 phút.
    expect(cacheOf("avatar")).toContain('"private, max-age=60"');
    expect(cacheOf("photo")).toContain('"private, max-age=600"');
    for (const f of ["avatar", "photo"]) {
      expect(cacheOf(f), f).not.toContain('"private, no-cache"');
      expect(cacheOf(f), f).toContain("ETag"); // hết hạn thì hỏi lại vẫn rẻ (304, không tải lại ảnh)
    }
  });
  it("ảnh vẫn chỉ gửi cho người được xem (đường dẫn qua kiểm quyền, không phải file tĩnh)", () => {
    expect(cacheOf("photo")).toContain("canSeeProfilePhoto");
    expect(cacheOf("avatar")).toContain("canSeeFaceAvatar");
  });
});

describe("chỉ mục cho các truy vấn hay dùng", () => {
  it("schema khai đủ chỉ mục mới", () => {
    for (const idx of ["@@index([action, createdAt])", "@@index([status, createdAt])", "@@index([type, status, executedAt])", "@@index([active, departmentId, code])", "@@index([role, active])"]) {
      expect(schema, idx).toContain(idx);
    }
  });

  it("đã có migration tạo chỉ mục", () => {
    const dir = join(process.cwd(), "prisma", "migrations");
    const found = readFileSync(join(dir, "20260924083438_perf_indexes", "migration.sql"), "utf8");
    expect(found).toContain("AuditLog_action_createdAt_idx");
    expect(found).toContain("Employee_active_departmentId_code_idx");
    expect(existsSync(dir)).toBe(true);
  });

  it("chỉ mục đã áp vào DB test (migrate deploy chạy trong global-setup)", async () => {
    const rows = (await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='index'")) as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const n of ["AuditLog_action_createdAt_idx", "Employee_active_departmentId_code_idx", "LeaveRequest_status_createdAt_idx"]) {
      expect(names, n).toContain(n);
    }
  });
});
