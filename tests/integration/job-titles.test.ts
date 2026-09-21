// v1.7.0: danh mục Chức danh / Chuyên khoa — CRUD, gắn cho nhân viên, lọc, cột Excel.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayVN } from "@/lib/attendance";
import { buildAttendanceReport } from "@/lib/reports";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as titlesRoute from "@/app/api/job-titles/route";
import * as titleRoute from "@/app/api/job-titles/[id]/route";
import * as specsRoute from "@/app/api/specialties/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as rosterRoute from "@/app/api/roster/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, mgr: E, emp: E;
let A: string, M: string;
const tag = `jt-${Date.now()}`;

beforeAll(async () => {
  [admin, mgr, emp] = await Promise.all(["NV001", "NV003", "NV008"].map(byCode));
  [A, M] = await Promise.all([admin, mgr].map((e) => sessionCookie(e.id)));
});

afterAll(async () => {
  await prisma.employee.update({ where: { id: emp.id }, data: { jobTitleId: null, specialtyId: null } });
  await prisma.jobTitle.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.specialty.deleteMany({ where: { name: { startsWith: tag } } });
});

describe("danh mục chức danh / chuyên khoa", () => {
  let titleId = 0;
  let specId = 0;

  it("Quản trị thêm được, trùng tên → 400, Quản lý (không có org.manage) → 403, mọi người đăng nhập đọc được", async () => {
    const create = (cookie: string, name: string) => titlesRoute.POST(req("/api/job-titles", { method: "POST", cookie, body: { name } }), ctx());
    const r = await create(A, `${tag} Bác sĩ`);
    expect(r.status).toBe(201);
    titleId = (await r.json()).item.id;
    expect((await create(A, `${tag} Bác sĩ`)).status).toBe(400);
    // Trùng khi chỉ khác hoa/thường hoặc khác cách gõ dấu (NFD) cũng bị chặn.
    expect((await create(A, `${tag} BÁC SĨ`)).status).toBe(400);
    expect((await create(A, `${tag} Bác sĩ`.normalize("NFD"))).status).toBe(400);
    expect((await create(M, `${tag} Khác`)).status).toBe(403);
    expect((await create(A, "x")).status).toBe(400);
    const s = await specsRoute.POST(req("/api/specialties", { method: "POST", cookie: A, body: { name: `${tag} Tai Mũi Họng` } }), ctx());
    expect(s.status).toBe(201);
    specId = (await s.json()).item.id;
    const list = await (await titlesRoute.GET(req("/api/job-titles", { cookie: await sessionCookie(emp.id) }), ctx())).json();
    expect(list.items.some((x: { id: number }) => x.id === titleId)).toBe(true);
  });

  it("gắn cho nhân viên: lọc danh sách, hiện trong xếp ca và cột Excel; id không tồn tại → 400", async () => {
    const patch = (body: unknown) => employeeRoute.PATCH(req(`/api/employees/${emp.id}`, { method: "PATCH", cookie: A, body }), ctx({ id: String(emp.id) }));
    expect((await patch({ jobTitleId: 999999 })).status).toBe(400);
    expect((await patch({ jobTitleId: titleId, specialtyId: specId })).status).toBe(200);

    const list = await (await employeesRoute.GET(req(`/api/employees?jobTitleId=${titleId}`, { cookie: A }), ctx())).json();
    expect(list.employees.map((e: { id: number }) => e.id)).toEqual([emp.id]);
    expect(list.employees[0]).toMatchObject({ jobTitle: { name: `${tag} Bác sĩ` }, specialty: { name: `${tag} Tai Mũi Họng` } });
    // Đổi chức danh không làm thay đổi lịch (không tạo bản ghi phân công mới hôm nay).
    expect(await prisma.scheduleAssignment.count({ where: { employeeId: emp.id, effectiveFrom: todayVN() } })).toBe(0);

    const roster = await (await rosterRoute.GET(req(`/api/roster?group=all&departmentId=${emp.departmentId}`, { cookie: A }), ctx())).json();
    expect(roster.employees.find((e: { id: number }) => e.id === emp.id)?.title).toBe(`${tag} Bác sĩ · ${tag} Tai Mũi Họng`);

    const rep = await buildAttendanceReport({ id: emp.id }, addDays(todayVN(), -6), todayVN());
    expect(rep.summary[0]).toMatchObject({ jobTitle: `${tag} Bác sĩ`, specialty: `${tag} Tai Mũi Họng` });
  });

  it("đổi tên; xóa mục đang dùng → nhân viên được để trống, không lỗi", async () => {
    const rn = await titleRoute.PATCH(req(`/api/job-titles/${titleId}`, { method: "PATCH", cookie: A, body: { name: `${tag} Bác sĩ CK1` } }), ctx({ id: String(titleId) }));
    expect(rn.status).toBe(200);
    const del = await titleRoute.DELETE(req(`/api/job-titles/${titleId}`, { method: "DELETE", cookie: A }), ctx({ id: String(titleId) }));
    expect(del.status).toBe(200);
    expect((await del.json()).detached).toBe(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } })).jobTitleId).toBeNull();
    expect((await titleRoute.DELETE(req(`/api/job-titles/${titleId}`, { method: "DELETE", cookie: A }), ctx({ id: String(titleId) }))).status).toBe(404);
  });
});
