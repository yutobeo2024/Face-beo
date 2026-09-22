// QC v1.13.0 — ảnh đại diện tự chọn: các ca đối kháng (đồng thời, nghỉ việc song song, quyền quản lý được cấp thêm, xóa cứng,
// ETag, định dạng lạ, EXIF xoay, riêng tư của nhân viên thường, GET đọc khóa cũ trong lúc đổi ảnh).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { invalidatePermissionCache } from "@/lib/permissions";
import { createEmployee } from "@/lib/employees";
import { byCode, ctx, req, sessionCookie } from "./helpers";

// Chèn điểm dừng trước khi GET đọc file ảnh → tái hiện xen kẽ GET (khóa cũ) với PUT (đổi ảnh) một cách tất định.
const gate = vi.hoisted(() => ({ beforeRead: null as null | (() => Promise<void>) }));
vi.mock("@/lib/profile-photo", async (orig) => {
  const a = await orig<typeof import("@/lib/profile-photo")>();
  return {
    ...a,
    readProfilePhoto: async (id: number, key: string | null) => {
      const h = gate.beforeRead;
      if (h) {
        gate.beforeRead = null;
        await h();
      }
      return a.readProfilePhoto(id, key);
    },
  };
});

import * as photoRoute from "@/app/api/employees/[id]/photo/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
// NV001 Quản trị (phòng 0), NV002 quản lý phòng 0, NV003 quản lý phòng 1, NV007 NV phòng 0, NV008 NV phòng 1,
// NV009 NV phòng 2, NV013 NV phòng 4, NV014 NV phòng 4, NV016 Nhân sự (phòng 0).
let admin: E, hr: E, m0: E, m1: E, e0: E, e1: E, e2: E, e13: E, e14: E;
let A: string, H: string, M0: string, M1: string, E0: string, E1: string, E14: string;
const tempIds: number[] = [];
let savedPerms: { role: string; capability: string }[] = [];

const dir = (id: number) => join(dataDir(), "photos", String(id));
const files = (id: number) => (existsSync(dir(id)) ? readdirSync(dir(id)) : []);
const dbKey = async (id: number) => (await prisma.employee.findUniqueOrThrow({ where: { id } })).photoKey;

const put = (cookie: string, id: number, body: Uint8Array) =>
  photoRoute.PUT(
    new NextRequest(new URL(`/api/employees/${id}/photo`, "http://localhost"), { method: "PUT", headers: { cookie, "content-type": "application/octet-stream" }, body: body as BodyInit }),
    ctx({ id: String(id) }),
  );
const del = (cookie: string, id: number) => photoRoute.DELETE(req(`/api/employees/${id}/photo`, { method: "DELETE", cookie }), ctx({ id: String(id) }));
const get = (cookie: string, id: number, headers: Record<string, string> = {}) => photoRoute.GET(req(`/api/employees/${id}/photo`, { cookie, headers }), ctx({ id: String(id) }));
const img = (seed = 0, w = 700, h = 900) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: (seed * 37) % 256, g: 100, b: 50 } } })
    .jpeg()
    .toBuffer()
    .then((b) => new Uint8Array(b));
const listRows = async (cookie: string) => {
  const r = await employeesRoute.GET(req("/api/employees?includeInactive=1", { cookie }), ctx());
  return (await r.json()).employees as { id: number; avatarUrl: string | null; hasPhoto: boolean; canEditPhoto: boolean }[] | undefined;
};
async function setPerm(role: string, cap: string, on: boolean) {
  if (on) await prisma.rolePermission.upsert({ where: { role_capability: { role, capability: cap } }, create: { role, capability: cap }, update: {} });
  else await prisma.rolePermission.deleteMany({ where: { role, capability: cap } });
  invalidatePermissionCache();
}
async function newEmp(role: string, like: E, tag: string) {
  const { employee } = await createEmployee(
    { code: `QP${tag}${Date.now() % 100000}`, name: `QC ảnh ${tag}`, role, departmentId: like.departmentId, defaultShiftId: like.defaultShiftId } as never,
    null,
  );
  tempIds.push(employee.id);
  return employee;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  savedPerms = await prisma.rolePermission.findMany();
  [admin, hr, m0, m1, e0, e1, e2, e13, e14] = await Promise.all(["NV001", "NV016", "NV002", "NV003", "NV007", "NV008", "NV009", "NV013", "NV014"].map(byCode));
  [A, H, M0, M1, E0, E1, E14] = await Promise.all([admin, hr, m0, m1, e0, e1, e14].map((e) => sessionCookie(e.id)));
});

afterAll(async () => {
  gate.beforeRead = null;
  await prisma.$transaction([prisma.rolePermission.deleteMany(), prisma.rolePermission.createMany({ data: savedPerms })]);
  invalidatePermissionCache();
  for (const e of [admin, hr, m0, m1, e0, e1, e2, e13, e14]) {
    await del(A, e.id);
    await prisma.employee.update({ where: { id: e.id }, data: { active: e.active, photoKey: null, photoAt: null, sessionVersion: e.sessionVersion } });
  }
  // Phòng mà NV quản lý có thể bị gỡ khi cho nghỉ (không dùng quản lý ở ca nghỉ việc, nhưng giữ an toàn).
  for (const id of tempIds) {
    await employeeRoute.DELETE(req(`/api/employees/${id}`, { method: "DELETE", cookie: A }), ctx({ id: String(id) })).catch(() => {});
    await prisma.employee.deleteMany({ where: { id } }).catch(() => {});
  }
});

describe("QC ảnh đại diện tự chọn", () => {
  it("5 lượt PUT đồng thời của chính chủ: đều 200, còn đúng 1 file và DB trỏ tới file đó", async () => {
    const pics = await Promise.all([1, 2, 3, 4, 5].map((s) => img(s)));
    const rs = await Promise.all(pics.map((p) => put(E1, e1.id, p)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const f = files(e1.id);
    expect(f).toHaveLength(1);
    expect(await dbKey(e1.id)).toBe(f[0]);
    expect((await get(E1, e1.id)).status).toBe(200);
  });

  it("PUT song song với cho nghỉ việc (lặp 4 lần): kết cục luôn không còn file, không còn khóa ảnh", async () => {
    for (let i = 0; i < 4; i++) {
      await prisma.employee.update({ where: { id: e13.id }, data: { active: true } });
      const pic = await img(10 + i);
      const [p, patch] = await Promise.all([
        put(A, e13.id, pic),
        employeeRoute.PATCH(req(`/api/employees/${e13.id}`, { method: "PATCH", cookie: A, body: { active: false } }), ctx({ id: String(e13.id) })),
      ]);
      expect(patch.status).toBe(200);
      expect([200, 400]).toContain(p.status);
      expect(files(e13.id)).toEqual([]);
      expect(await dbKey(e13.id)).toBeNull();
    }
    await prisma.employee.update({ where: { id: e13.id }, data: { active: true } });
  });

  it("Quản lý được cấp employees.manage: sửa được NV phòng mình; không sửa phòng khác, không sửa Nhân sự / Quản trị cùng phòng", async () => {
    await setPerm("MANAGER", "employees.manage", true);
    try {
      const pic = await img(20);
      expect((await put(M0, e0.id, pic)).status).toBe(200);
      expect((await del(M0, e0.id)).status).toBe(200);
      expect((await put(M0, e2.id, pic)).status).toBe(403); // phòng 2
      expect((await put(M0, hr.id, pic)).status).toBe(403); // Nhân sự cùng phòng 0
      expect((await put(M0, admin.id, pic)).status).toBe(403); // Quản trị cùng phòng 0
      expect((await del(M0, hr.id)).status).toBe(403);
      expect((await put(M1, e0.id, pic)).status).toBe(403); // quản lý phòng 1 sang phòng 0
      const rows = (await listRows(M0))!;
      expect(rows.find((r) => r.id === e0.id)?.canEditPhoto).toBe(true);
      expect(rows.find((r) => r.id === hr.id)?.canEditPhoto).toBe(false);
      expect(rows.find((r) => r.id === admin.id)?.canEditPhoto).toBe(false);
      expect(rows.find((r) => r.id === e2.id)).toBeUndefined();
      expect(rows.find((r) => r.id === m0.id)?.canEditPhoto).toBe(true); // chính mình
    } finally {
      await setPerm("MANAGER", "employees.manage", false);
    }
    // Thu hồi quyền → hết sửa được.
    expect((await put(M0, e0.id, await img(21))).status).toBe(403);
  });

  it("Nhân sự sửa được ảnh của Quản lý, không sửa được Nhân sự khác", async () => {
    expect((await put(H, m1.id, await img(30))).status).toBe(200);
    const hr2 = await newEmp("HR", hr, "H");
    expect((await put(H, hr2.id, await img(31))).status).toBe(403);
    expect((await put(A, hr2.id, await img(31))).status).toBe(200);
    expect((await del(H, hr2.id)).status).toBe(403);
    const row = (await listRows(H))!.find((r) => r.id === hr2.id);
    expect(row?.canEditPhoto).toBe(false);
    expect(row?.hasPhoto).toBe(true);
  });

  it("xóa cứng tài khoản tạo nhầm: xóa cả thư mục ảnh", async () => {
    const t = await newEmp("EMPLOYEE", e0, "D");
    expect((await put(A, t.id, await img(40))).status).toBe(200);
    expect(files(t.id)).toHaveLength(1);
    const r = await employeeRoute.DELETE(req(`/api/employees/${t.id}`, { method: "DELETE", cookie: A }), ctx({ id: String(t.id) }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(existsSync(dir(t.id))).toBe(false);
    expect((await get(A, t.id)).status).toBe(404);
  });

  it("người đã nghỉ việc: ảnh không còn trong danh sách / GET 404; chính chủ mất phiên", async () => {
    const t = await newEmp("EMPLOYEE", e14, "I");
    const TC = await sessionCookie(t.id);
    expect((await put(TC, t.id, await img(50))).status).toBe(200);
    const r = await employeeRoute.PATCH(req(`/api/employees/${t.id}`, { method: "PATCH", cookie: A, body: { active: false } }), ctx({ id: String(t.id) }));
    expect(r.status).toBe(200);
    const row = (await listRows(A))!.find((x) => x.id === t.id);
    expect(row?.hasPhoto).toBe(false);
    expect(row?.canEditPhoto).toBe(false);
    expect(row?.avatarUrl ?? "").not.toMatch(/\/photo/);
    expect((await get(A, t.id)).status).toBe(404);
    expect((await put(TC, t.id, await img(51))).status).toBe(401);
    expect(files(t.id)).toEqual([]);
  });

  it("ETag: If-None-Match khớp → 304 không thân; ETag cũ sau khi đổi ảnh → 200", async () => {
    expect((await put(E14, e14.id, await img(60))).status).toBe(200);
    const g = await get(E14, e14.id);
    const etag = g.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f-]{36}\.jpg"$/);
    expect(g.headers.get("cache-control")).toContain("private");
    const g2 = await get(E14, e14.id, { "if-none-match": etag });
    expect(g2.status).toBe(304);
    expect((await g2.arrayBuffer()).byteLength).toBe(0);
    expect((await put(E14, e14.id, await img(61))).status).toBe(200);
    const g3 = await get(E14, e14.id, { "if-none-match": etag });
    expect(g3.status).toBe(200);
    expect(g3.headers.get("etag")).not.toBe(etag);
  });

  it("GIF, SVG, HTML, đa hình (đầu JPEG + SVG) đều bị chặn 400, không để lại file", async () => {
    const before = files(e0.id);
    const keyBefore = await dbKey(e0.id);
    const gif = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#f00" } }).gif().toBuffer());
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><script>alert(1)</script></svg>');
    const html = new TextEncoder().encode("<html><body>x</body></html>");
    const poly = new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')]);
    const riffNotWebp = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WAVE"), 0, 0, 0, 0]);
    for (const b of [gif, svg, html, poly, riffNotWebp]) {
      const r = await put(E0, e0.id, b);
      expect(r.status).toBe(400);
    }
    expect(files(e0.id)).toEqual(before);
    expect(await dbKey(e0.id)).toBe(keyBefore);
  });

  it("JPEG có EXIF Orientation=6 (chụp dọc điện thoại) → 600×800, đã xoay thẳng, không còn EXIF", async () => {
    // Ảnh lưu nằm ngang 800×600: nửa trái đỏ, nửa phải xanh. Orientation 6 = xoay 90° chiều kim đồng hồ khi hiển thị
    // → sau xoay: nửa trên đỏ, nửa dưới xanh, khung dọc 600×800.
    const half = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const raw = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([{ input: half, left: 400, top: 0 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(raw).metadata()).orientation).toBe(6);
    expect((await put(E0, e0.id, new Uint8Array(raw))).status).toBe(200);
    const out = Buffer.from(await (await get(E0, e0.id)).arrayBuffer());
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.orientation, meta.exif]).toEqual([600, 800, undefined, undefined]);
    const px = async (x: number, y: number) => {
      const { data } = await sharp(out).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    const top = await px(300, 100);
    const bottom = await px(300, 700);
    expect(top[0]).toBeGreaterThan(200); // đỏ
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2]).toBeGreaterThan(200); // xanh
    expect(bottom[0]).toBeLessThan(60);
  });

  it("riêng tư: nhân viên thường chỉ xem ảnh của chính mình; không vào danh sách; chi tiết người khác 403", async () => {
    expect((await put(H, e0.id, await img(70))).status).toBe(200); // e0 (phòng 0) có ảnh
    expect((await put(E14, e14.id, await img(71))).status).toBe(200);
    expect((await get(E14, e14.id)).status).toBe(200);
    expect((await get(E14, e13.id)).status).toBe(403); // cùng phòng 4
    expect((await get(E14, e0.id)).status).toBe(403);
    expect((await get(E14, admin.id)).status).toBe(403);
    expect((await employeesRoute.GET(req("/api/employees", { cookie: E14 }), ctx())).status).toBe(403);
    expect((await employeeRoute.GET(req(`/api/employees/${e0.id}`, { cookie: E14 }), ctx({ id: String(e0.id) }))).status).toBe(403);
    // Không đăng nhập / id rác.
    expect((await photoRoute.GET(req(`/api/employees/${e0.id}/photo`), ctx({ id: String(e0.id) }))).status).toBe(401);
    expect((await get(A, Number.NaN)).status).toBe(400);
  });

  it("GET đọc khóa ảnh CŨ trong lúc chính chủ đổi ảnh: không được xóa ảnh MỚI", async () => {
    expect((await put(E1, e1.id, await img(80))).status).toBe(200);
    const oldKey = await dbKey(e1.id);
    let newKey: string | null = null;
    // GET đã nạp DB (khóa cũ) → trước khi đọc file, một lượt PUT hoàn tất (ghi file mới, xóa file cũ).
    gate.beforeRead = async () => {
      const r = await put(E1, e1.id, await img(81));
      expect(r.status).toBe(200);
      newKey = await dbKey(e1.id);
    };
    const g = await get(H, e1.id);
    expect(newKey).not.toBe(oldKey);
    // Kỳ vọng: GET có thể 404 (file cũ đã thay) nhưng ảnh mới phải còn nguyên.
    expect([200, 404]).toContain(g.status);
    expect(await dbKey(e1.id), "ảnh mới bị GET xóa nhầm (khóa DB)").toBe(newKey);
    expect(files(e1.id), "ảnh mới bị GET xóa nhầm (file)").toEqual([newKey]);
  });
});
