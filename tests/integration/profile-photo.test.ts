// v1.13.0: ảnh đại diện tự chọn — tải lên / xóa, quyền, giới hạn dung lượng, chuẩn hóa 600×800, thứ tự hiển thị, xóa khi nghỉ việc.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { snapshotCleanup } from "@/lib/jobs";
import { MAX_PHOTO_UPLOAD_BYTES, clearStalePhoto } from "@/lib/profile-photo";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as photoRoute from "@/app/api/employees/[id]/photo/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as overviewRoute from "@/app/api/me/overview/route";
import * as facesRoute from "@/app/api/employees/[id]/faces/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, otherMgr: E, target: E, other: E;
let A: string, H: string, M: string, OM: string, T: string, O: string;
const dir = (e: E) => join(dataDir(), "photos", String(e.id));
const files = (e: E) => (existsSync(dir(e)) ? readdirSync(dir(e)) : []);

const put = (cookie: string, e: E, body: Uint8Array, headers: Record<string, string> = {}) =>
  photoRoute.PUT(
    new NextRequest(new URL(`/api/employees/${e.id}/photo`, "http://localhost"), { method: "PUT", headers: { cookie, "content-type": "image/jpeg", ...headers }, body: body as BodyInit }),
    ctx({ id: String(e.id) }),
  );
const del = (cookie: string, e: E) => photoRoute.DELETE(req(`/api/employees/${e.id}/photo`, { method: "DELETE", cookie }), ctx({ id: String(e.id) }));
const get = (cookie: string, e: E) => photoRoute.GET(req(`/api/employees/${e.id}/photo`, { cookie }), ctx({ id: String(e.id) }));
const img = (w = 900, h = 1200, fmt: "jpeg" | "png" | "webp" = "jpeg") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 60 } } })
    [fmt]()
    .withMetadata({ exif: { IFD0: { Artist: "bi-mat" } } })
    .toBuffer()
    .then((b) => new Uint8Array(b));
const listRow = async (cookie: string, e: E) => {
  const r = await employeesRoute.GET(req("/api/employees?includeInactive=1", { cookie }), ctx());
  return ((await r.json()).employees as { id: number; avatarUrl: string | null; hasPhoto: boolean; canEditPhoto: boolean }[]).find((x) => x.id === e.id);
};

beforeAll(async () => {
  // NV008 thuộc phòng NV003 quản lý; NV004 quản lý phòng khác; NV009 nhân viên phòng khác; NV016 Nhân sự; NV001 Quản trị.
  [admin, hr, mgr, otherMgr, target, other] = await Promise.all(["NV001", "NV016", "NV003", "NV004", "NV008", "NV009"].map(byCode));
  [A, H, M, OM, T, O] = await Promise.all([admin, hr, mgr, otherMgr, target, other].map((e) => sessionCookie(e.id)));
});
afterAll(async () => {
  for (const e of [admin, hr, target, other]) {
    await photoRoute.DELETE(req(`/api/employees/${e.id}/photo`, { method: "DELETE", cookie: A }), ctx({ id: String(e.id) }));
    await prisma.employee.update({ where: { id: e.id }, data: { active: true, photoKey: null, photoAt: null } });
  }
});

describe("ảnh đại diện tự chọn", () => {
  it("chính chủ tải ảnh: lưu 1 file 600×800 JPEG, bỏ EXIF, ghi nhật ký", async () => {
    const r = await put(T, target, await img(1000, 1000, "png"));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect((await r.json()).photoUrl).toMatch(new RegExp(`^/api/employees/${target.id}/photo\\?v=\\d+$`));
    expect(files(target)).toHaveLength(1);
    const g = await get(T, target);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await g.arrayBuffer())).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([600, 800, "jpeg"]);
    expect(meta.exif).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: "PHOTO_UPDATE", entityId: String(target.id) } })).toBeGreaterThan(0);
  });

  it("đổi ảnh lần nữa: vẫn chỉ 1 file (ảnh cũ bị dọn), ETag đổi", async () => {
    const before = (await get(T, target)).headers.get("etag");
    expect((await put(T, target, await img(600, 800, "webp"))).status).toBe(200);
    expect(files(target)).toHaveLength(1);
    expect((await get(T, target)).headers.get("etag")).not.toBe(before);
  });

  it("danh sách + chi tiết + /me: ảnh tự chọn được ưu tiên, kèm hasPhoto / canEditPhoto", async () => {
    const row = await listRow(H, target);
    expect(row?.avatarUrl).toMatch(/\/photo\?v=/);
    expect(row?.hasPhoto).toBe(true);
    expect(row?.canEditPhoto).toBe(true);
    // Quản lý phòng: thấy ảnh nhưng mặc định không có quyền sửa nhân viên → không sửa ảnh.
    const mrow = await listRow(M, target);
    expect(mrow?.avatarUrl).toMatch(/\/photo\?v=/);
    expect(mrow?.canEditPhoto).toBe(false);
    const d = await (await employeeRoute.GET(req(`/api/employees/${target.id}`, { cookie: M }), ctx({ id: String(target.id) }))).json();
    expect(d.employee.avatarUrl).toMatch(/\/photo\?v=/);
    const me = await (await overviewRoute.GET(req("/api/me/overview", { cookie: T }), ctx())).json();
    expect(me.me.avatarUrl).toMatch(/\/photo\?v=/);
    expect(me.me).toMatchObject({ id: target.id, hasPhoto: true, canEditPhoto: true });
  });

  it("quyền xem: chính chủ, Nhân sự, quản lý phòng — không cho quản lý phòng khác / nhân viên khác", async () => {
    expect((await get(H, target)).status).toBe(200);
    expect((await get(M, target)).status).toBe(200);
    expect((await get(OM, target)).status).toBe(403);
    expect((await get(O, target)).status).toBe(403);
  });

  it("quyền sửa: quản lý / nhân viên khác bị chặn; Nhân sự không sửa ảnh Quản trị; Quản trị sửa được Nhân sự", async () => {
    const pic = await img();
    expect((await put(M, target, pic)).status).toBe(403);
    expect((await put(O, target, pic)).status).toBe(403);
    expect((await del(O, target)).status).toBe(403);
    expect((await put(H, admin, pic)).status).toBe(403);
    expect((await put(A, hr, pic)).status).toBe(200);
    expect((await put(H, target, pic)).status).toBe(200);
    expect((await put(H, hr, pic)).status).toBe(200); // Nhân sự tự đổi ảnh của mình
  });

  it("giới hạn: > 2 MB, file không phải ảnh, ảnh hỏng, ảnh quá nhiều điểm ảnh → 400, không để lại file", async () => {
    const before = files(other);
    const big = new Uint8Array(MAX_PHOTO_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const r1 = await put(O, other, big);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/2 MB/);
    // Content-Length khai sai (nhỏ) nhưng thân lớn: vẫn chặn khi đọc.
    expect((await put(O, other, big, { "content-length": "10" })).status).toBe(400);
    const pdf = new TextEncoder().encode("%PDF-1.4 not an image");
    expect((await (await put(O, other, pdf)).json()).error).toMatch(/JPG, PNG hoặc WebP/);
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
    expect((await put(O, other, broken)).status).toBe(400);
    // PNG 6000×5000 = 30 triệu điểm ảnh (nén nhỏ hơn 2 MB) → chặn.
    const huge = new Uint8Array(await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer());
    expect(huge.length).toBeLessThan(MAX_PHOTO_UPLOAD_BYTES);
    expect((await put(O, other, huge)).status).toBe(400);
    expect((await put(O, other, new Uint8Array())).status).toBe(400);
    expect(files(other)).toEqual(before);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: other.id } })).photoKey).toBeNull();
  });

  it("xóa ảnh tự chọn → quay về ảnh khuôn mặt / chữ viết tắt; xóa lần 2 vẫn ok", async () => {
    expect((await put(O, other, await img())).status).toBe(200);
    expect((await del(O, other)).status).toBe(200);
    expect(files(other)).toHaveLength(0);
    const row = await listRow(H, other);
    expect(row?.hasPhoto).toBe(false);
    expect(row?.avatarUrl ?? "").not.toMatch(/\/photo/);
    expect((await get(O, other)).status).toBe(404);
    expect((await del(O, other)).status).toBe(200);
  });

  it("xóa khuôn mặt KHÔNG xóa ảnh tự chọn (không phải dữ liệu sinh trắc)", async () => {
    expect((await put(T, target, await img())).status).toBe(200);
    const r = await facesRoute.DELETE(req(`/api/employees/${target.id}/faces`, { method: "DELETE", cookie: A }), ctx({ id: String(target.id) }));
    expect(r.status).toBeLessThan(300);
    expect(files(target)).toHaveLength(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).photoKey).not.toBeNull();
  });

  it("nghỉ việc: xóa ảnh tự chọn; người đã nghỉ không tải ảnh mới được; job dọn bắt các ca sót", async () => {
    const r = await employeeRoute.PATCH(req(`/api/employees/${target.id}`, { method: "PATCH", cookie: A, body: { active: false } }), ctx({ id: String(target.id) }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(files(target)).toHaveLength(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).photoKey).toBeNull();
    expect((await put(A, target, await img())).status).toBe(400);
    // Ca sót (vd. dữ liệu cũ): người nghỉ việc còn khóa ảnh → job dọn hằng ngày xóa.
    await prisma.employee.update({ where: { id: target.id }, data: { photoKey: "00000000-0000-0000-0000-000000000000.jpg", photoAt: new Date() } });
    await snapshotCleanup();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).photoKey).toBeNull();
    await prisma.employee.update({ where: { id: target.id }, data: { active: true } });
  });

  it("DB trỏ tới file đã mất: GET 404 và tự dọn khóa", async () => {
    await prisma.employee.update({ where: { id: other.id }, data: { photoKey: "11111111-1111-1111-1111-111111111111.jpg", photoAt: new Date() } });
    expect((await get(O, other)).status).toBe(404);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: other.id } })).photoKey).toBeNull();
  });

  it("dọn khóa hỏng không xóa nhầm ảnh vừa tải lên song song (lượt đọc cầm khóa cũ)", async () => {
    expect((await put(O, other, await img())).status).toBe(200);
    const cur = (await prisma.employee.findUniqueOrThrow({ where: { id: other.id } })).photoKey!;
    await clearStalePhoto(other.id, "22222222-2222-2222-2222-222222222222.jpg");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: other.id } })).photoKey).toBe(cur);
    expect(files(other)).toEqual([cur]);
    expect((await get(O, other)).status).toBe(200);
  });
});
