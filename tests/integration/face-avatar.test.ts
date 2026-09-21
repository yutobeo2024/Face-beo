// v1.10.0: ảnh khuôn mặt đại diện (tấm nhìn thẳng lúc enroll) — lưu, quyền xem, xóa cùng dữ liệu khuôn mặt.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { __setFaceEmbedTestHook } from "@/lib/face-embed";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { snapshotCleanup } from "@/lib/jobs";
import { byCode, ctx, fakeEmbedding, req, SAMPLE_LANDMARKS, sampleJpegDataUrl, sessionCookie } from "./helpers";

import * as facesRoute from "@/app/api/employees/[id]/faces/route";
import * as avatarRoute from "@/app/api/employees/[id]/avatar/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";
import * as consentRoute from "@/app/api/employees/[id]/consent/route";
import * as overviewRoute from "@/app/api/me/overview/route";

type E = Awaited<ReturnType<typeof byCode>>;
let hr: E, mgr: E, otherMgr: E, target: E, other: E, spare: E;
let H: string, M: string, OM: string, T: string, O: string;
const POSES = ["FRONT", "LEFT", "RIGHT", "UP", "DOWN"];
const dir = (e: E) => join(dataDir(), "avatars", String(e.id));
const files = (e: E) => (existsSync(dir(e)) ? readdirSync(dir(e)) : []);
const near = (k: number) => fakeEmbedding(77).map((x, j) => x + fakeEmbedding(700 + k)[j] * 0.03);

async function enroll(e: E, samples?: unknown[]) {
  let i = 0;
  __setFaceEmbedTestHook(() => Float32Array.from(near(i++ % 5)));
  await prisma.employee.update({ where: { id: e.id }, data: { biometricConsentAt: new Date() } });
  const body = { samples: samples ?? POSES.map((pose) => ({ pose, faceSize: 260, snapshot: sampleJpegDataUrl(), landmarks: SAMPLE_LANDMARKS })) };
  return facesRoute.POST(req(`/api/employees/${e.id}/faces`, { method: "POST", cookie: H, body }), ctx({ id: String(e.id) }));
}
const getAvatar = (cookie: string, e: E) => avatarRoute.GET(req(`/api/employees/${e.id}/avatar`, { cookie }), ctx({ id: String(e.id) }));
const listUrl = async (cookie: string, e: E) => {
  const r = await employeesRoute.GET(req("/api/employees?includeInactive=1", { cookie }), ctx());
  return ((await r.json()).employees as { id: number; avatarUrl: string | null; faceAvatarKey?: string }[]).find((x) => x.id === e.id);
};

beforeAll(async () => {
  // NV008 thuộc phòng NV003 quản lý; NV004 quản lý phòng khác; NV009 nhân viên phòng khác.
  [hr, mgr, otherMgr, target, other, spare] = await Promise.all(["NV016", "NV003", "NV004", "NV008", "NV009", "NV012"].map(byCode));
  [H, M, OM, T, O] = await Promise.all([hr, mgr, otherMgr, target, other].map((e) => sessionCookie(e.id)));
  for (const e of [target, spare]) await prisma.faceTemplate.deleteMany({ where: { employeeId: e.id } });
  invalidateFaceCache();
});
afterAll(async () => {
  __setFaceEmbedTestHook(null);
  for (const e of [target, spare]) {
    await prisma.faceTemplate.deleteMany({ where: { employeeId: e.id } });
    await prisma.employee.update({ where: { id: e.id }, data: { active: true, faceAvatarKey: null, faceAvatarAt: null } });
  }
  invalidateFaceCache();
});

describe("ảnh đại diện từ mẫu nhìn thẳng", () => {
  it("enroll lưu đúng 1 ảnh 256×256 JPEG (không phải 5 ảnh), trả avatar=true", async () => {
    const r = await enroll(target);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect((await r.json()).avatar).toBe(true);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: target.id } });
    expect(e.faceAvatarKey).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(files(target)).toEqual([e.faceAvatarKey]);
    const meta = await sharp(join(dir(target), e.faceAvatarKey!)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 256, 256]);
  });

  it("quyền xem: chính chủ, Nhân sự, quản lý phòng mình → 200; quản lý phòng khác, nhân viên khác → 403", async () => {
    for (const c of [T, H, M]) {
      const r = await getAvatar(c, target);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/jpeg");
    }
    expect((await getAvatar(OM, target)).status).toBe(403);
    expect((await getAvatar(O, target)).status).toBe(403);
    expect((await getAvatar(H, other)).status).toBe(404); // chưa có ảnh
  });

  it("danh sách / chi tiết / trang cá nhân trả avatarUrl theo quyền, không lộ tên file", async () => {
    const byHr = await listUrl(H, target);
    expect(byHr!.avatarUrl).toMatch(new RegExp(`^/api/employees/${target.id}/avatar\\?v=\\d+$`));
    expect(byHr!.faceAvatarKey).toBeUndefined();
    expect((await listUrl(M, target))!.avatarUrl).toBeTruthy();
    const detail = await (await employeeRoute.GET(req(`/api/employees/${target.id}`, { cookie: T }), ctx({ id: String(target.id) }))).json();
    expect(detail.employee.avatarUrl).toBeTruthy();
    expect(detail.employee.faceAvatarKey).toBeUndefined();
    const me = await (await overviewRoute.GET(req("/api/me/overview", { cookie: T }), ctx())).json();
    expect(me.me.avatarUrl).toBeTruthy();
    expect(me.me.faceAvatarKey).toBeUndefined();
  });

  it("enroll lại thay ảnh cũ (chỉ còn 1 file, phiên bản URL đổi)", async () => {
    const before = await prisma.employee.findUniqueOrThrow({ where: { id: target.id } });
    await new Promise((r) => setTimeout(r, 5));
    expect((await enroll(target)).status).toBe(200);
    const after = await prisma.employee.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.faceAvatarKey).not.toBe(before.faceAvatarKey);
    expect(files(target)).toEqual([after.faceAvatarKey]);
  });

  it("xóa khuôn mặt → mất ảnh; rút đồng ý → mất ảnh", async () => {
    const del = await facesRoute.DELETE(req(`/api/employees/${target.id}/faces`, { method: "DELETE", cookie: H }), ctx({ id: String(target.id) }));
    expect(del.status).toBe(200);
    expect(files(target)).toEqual([]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).faceAvatarKey).toBeNull();
    expect((await listUrl(H, target))!.avatarUrl).toBeNull();

    expect((await enroll(target)).status).toBe(200);
    const w = await consentRoute.DELETE(req(`/api/employees/${target.id}/consent`, { method: "DELETE", cookie: T }), ctx({ id: String(target.id) }));
    expect(w.status).toBe(200);
    expect(files(target)).toEqual([]);
    expect((await getAvatar(T, target)).status).toBe(404);
  });

  it("cho nghỉ việc (PATCH) → mất ảnh; job dọn dẹp xóa ảnh của người đã nghỉ", async () => {
    expect((await enroll(target)).status).toBe(200);
    const p = await employeeRoute.PATCH(req(`/api/employees/${target.id}`, { method: "PATCH", cookie: H, body: { active: false } }), ctx({ id: String(target.id) }));
    expect(p.status).toBe(200);
    expect(files(target)).toEqual([]);
    await prisma.employee.update({ where: { id: target.id }, data: { active: true } });

    expect((await enroll(spare)).status).toBe(200);
    await prisma.employee.update({ where: { id: spare.id }, data: { active: false } }); // nghỉ việc không qua route
    await snapshotCleanup(new Date());
    expect(files(spare)).toEqual([]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey).toBeNull();
  });

  it("file ảnh mất mà DB còn khóa (vd. khôi phục DB thiếu data/avatars) → GET 404 và tự dọn khóa; danh sách về null", async () => {
    await prisma.employee.update({ where: { id: target.id }, data: { active: true } });
    expect((await enroll(target)).status).toBe(200);
    rmSync(dir(target), { recursive: true, force: true }); // file biến mất ngoài ý muốn
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).faceAvatarKey).not.toBeNull();
    expect((await getAvatar(H, target)).status).toBe(404);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: target.id } })).faceAvatarKey).toBeNull();
    expect((await listUrl(H, target))!.avatarUrl).toBeNull();
    await prisma.faceTemplate.deleteMany({ where: { employeeId: target.id } }); // không để trùng khuôn mặt với test sau
    invalidateFaceCache();
  });

  it("lưu ảnh lỗi không làm hỏng enroll — vẫn lưu 5 mẫu, trả avatar=false, không có ảnh", async () => {
    await prisma.employee.update({ where: { id: spare.id }, data: { active: true } });
    // Chiếm chỗ thư mục ảnh bằng một FILE → ghi ảnh thất bại.
    mkdirSync(join(dataDir(), "avatars"), { recursive: true });
    writeFileSync(dir(spare), "x");
    try {
      const r = await enroll(spare);
      expect(r.status).toBe(200);
      expect((await r.json()).avatar).toBe(false);
      expect(await prisma.faceTemplate.count({ where: { employeeId: spare.id } })).toBe(5);
      expect((await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey).toBeNull();
    } finally {
      rmSync(dir(spare), { force: true, recursive: true });
    }
  });
});
