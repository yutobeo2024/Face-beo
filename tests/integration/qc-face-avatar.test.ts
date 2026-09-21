// QC v1.10.0 — ảnh khuôn mặt đại diện: các ca đối kháng (quyền, EXIF, cạnh ảnh, đồng thời, khóa DB giả mạo).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { __setFaceEmbedTestHook } from "@/lib/face-embed";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { DEFAULT_MATRIX, invalidatePermissionCache } from "@/lib/permissions";
import { createEmployee } from "@/lib/employees";
import { clearFaceAvatar, saveFaceAvatar } from "@/lib/face-avatar";
import { byCode, ctx, enrollFake, fakeEmbedding, req, SAMPLE_LANDMARKS, sampleJpegDataUrl, sessionCookie } from "./helpers";

import * as facesRoute from "@/app/api/employees/[id]/faces/route";
import * as avatarRoute from "@/app/api/employees/[id]/avatar/route";
import * as employeesRoute from "@/app/api/employees/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
type L = [number, number][];
let admin: E, hr: E, mgr: E, emp: E, mgr3: E, t8: E, spare: E;
let A: string, H: string, M: string, EM: string;
let savedPerms: { role: string; capability: string }[] = [];
let tempEmpId: number | null = null;
const POSES = ["FRONT", "LEFT", "RIGHT", "UP", "DOWN"];
const dir = (id: number) => join(dataDir(), "avatars", String(id));
const files = (id: number) => (existsSync(dir(id)) ? readdirSync(dir(id)) : []);
const near = (id: number, k: number) => fakeEmbedding(5000 + id).map((x, j) => x + fakeEmbedding(900 + k)[j] * 0.03);
const toUrl = (b: Buffer) => "data:image/jpeg;base64," + b.toString("base64");

async function enroll(id: number, front?: { snapshot: string; landmarks: L }, cookie = A) {
  let i = 0;
  __setFaceEmbedTestHook(() => Float32Array.from(near(id, i++ % 5)));
  await prisma.employee.update({ where: { id }, data: { biometricConsentAt: new Date() } });
  const samples = POSES.map((pose) =>
    pose === "FRONT" && front
      ? { pose, faceSize: 260, snapshot: front.snapshot, landmarks: front.landmarks }
      : { pose, faceSize: 260, snapshot: sampleJpegDataUrl(), landmarks: SAMPLE_LANDMARKS },
  );
  return facesRoute.POST(req(`/api/employees/${id}/faces`, { method: "POST", cookie, body: { samples } }), ctx({ id: String(id) }));
}
const getAvatar = (cookie: string, id: number) => avatarRoute.GET(req(`/api/employees/${id}/avatar`, { cookie }), ctx({ id: String(id) }));
async function listRow(cookie: string, id: number) {
  const r = await employeesRoute.GET(req("/api/employees?includeInactive=1", { cookie }), ctx());
  return ((await r.json()).employees as { id: number; avatarUrl: string | null }[] | undefined)?.find((x) => x.id === id);
}
async function setPerm(role: string, cap: string, on: boolean) {
  if (on) await prisma.rolePermission.upsert({ where: { role_capability: { role, capability: cap } }, create: { role, capability: cap }, update: {} });
  else await prisma.rolePermission.deleteMany({ where: { role, capability: cap } });
  invalidatePermissionCache();
}
async function resetPerms() {
  await prisma.$transaction([prisma.rolePermission.deleteMany(), prisma.rolePermission.createMany({ data: savedPerms })]);
  invalidatePermissionCache();
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("file:../data/test.db");
  [admin, hr, mgr, emp, mgr3, t8, spare] = await Promise.all(["NV001", "NV016", "NV002", "NV007", "NV003", "NV008", "NV013"].map(byCode));
  [A, H, M, EM] = await Promise.all([admin, hr, mgr, emp].map((e) => sessionCookie(e.id)));
  savedPerms = await prisma.rolePermission.findMany();
  // Bảo đảm ma trận mặc định có snapshots.view cho MANAGER, không có cho EMPLOYEE.
  expect(DEFAULT_MATRIX.MANAGER).toContain("snapshots.view");
  await setPerm("MANAGER", "snapshots.view", true);
  invalidateFaceCache();
});

afterAll(async () => {
  __setFaceEmbedTestHook(null);
  await resetPerms();
  for (const e of [emp, t8, spare, admin]) {
    await prisma.faceTemplate.deleteMany({ where: { employeeId: e.id } });
    await clearFaceAvatar(e.id);
    await prisma.employee.update({ where: { id: e.id }, data: { active: true } });
  }
  if (tempEmpId) {
    await prisma.faceTemplate.deleteMany({ where: { employeeId: tempEmpId } });
    await prisma.scheduleAssignment.deleteMany({ where: { employeeId: tempEmpId } });
    await prisma.employee.deleteMany({ where: { id: tempEmpId } });
    rmSync(dir(tempEmpId), { recursive: true, force: true });
  }
  rmSync(join(dataDir(), "avatars", "x.jpg"), { force: true });
  invalidateFaceCache();
});

describe("QC ảnh đại diện — quyền", () => {
  it("chuẩn bị: enroll NV007 (phòng của NV002) → avatar=true", async () => {
    expect(emp.departmentId).toBe(mgr.departmentId);
    const r = await enroll(emp.id);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect((await r.json()).avatar).toBe(true);
    expect((await getAvatar(M, emp.id)).status).toBe(200);
  });

  it("header: image/jpeg, nosniff, cache private (không public)", async () => {
    const r = await getAvatar(H, emp.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(r.headers.get("cache-control")).not.toMatch(/public/);
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["jpeg", 256, 256, undefined]);
  });

  it("quản lý bị gỡ quyền snapshots.view → 403, danh sách/chi tiết avatarUrl=null", async () => {
    await setPerm("MANAGER", "snapshots.view", false);
    try {
      expect((await getAvatar(M, emp.id)).status).toBe(403);
      const row = await listRow(M, emp.id);
      expect(row).toBeDefined();
      expect(row!.avatarUrl).toBeNull();
      const d = await (await employeeRoute.GET(req(`/api/employees/${emp.id}`, { cookie: M }), ctx({ id: String(emp.id) }))).json();
      expect(d.employee.avatarUrl).toBeNull();
      // chính chủ vẫn xem được ảnh của mình dù vai trò không có snapshots.view
      expect((await getAvatar(EM, emp.id)).status).toBe(200);
    } finally {
      await setPerm("MANAGER", "snapshots.view", true);
    }
  });

  it("quản lý phòng khác (NV003) → 403 và danh sách không có avatarUrl", async () => {
    const C3 = await sessionCookie(mgr3.id);
    expect((await getAvatar(C3, emp.id)).status).toBe(403);
    const row = await listRow(C3, emp.id);
    expect(row?.avatarUrl ?? null).toBeNull();
  });

  it("nhân viên được cấp employees.view → không thấy ảnh người khác", async () => {
    await setPerm("EMPLOYEE", "employees.view", true);
    try {
      const C8 = await sessionCookie(t8.id);
      await enrollFake(t8.id, 8101);
      await saveFaceAvatar(t8.id, Buffer.from(sampleJpegDataUrl().split(",")[1], "base64"), SAMPLE_LANDMARKS);
      const r = await employeesRoute.GET(req("/api/employees?includeInactive=1", { cookie: EM }), ctx());
      expect(r.status).toBe(200);
      const rows = (await r.json()).employees as { id: number; avatarUrl: string | null }[];
      for (const x of rows) if (x.id !== emp.id) expect(x.avatarUrl, `NV id ${x.id}`).toBeNull();
      expect((await getAvatar(EM, t8.id)).status).toBe(403);
      expect((await getAvatar(C8, emp.id)).status).toBe(403);
    } finally {
      await setPerm("EMPLOYEE", "employees.view", false);
      await clearFaceAvatar(t8.id);
    }
  });

  it("Nhân sự xem ảnh của Quản trị → 200 (snapshots.view toàn công ty)", async () => {
    await enrollFake(admin.id, 8102);
    await saveFaceAvatar(admin.id, Buffer.from(sampleJpegDataUrl().split(",")[1], "base64"), SAMPLE_LANDMARKS);
    try {
      expect((await getAvatar(H, admin.id)).status).toBe(200);
      expect((await listRow(H, admin.id))!.avatarUrl).toMatch(/\/avatar\?v=\d+$/);
    } finally {
      await clearFaceAvatar(admin.id);
    }
  });

  it("nhân viên nghỉ việc qua PATCH: 404 ảnh, avatarUrl=null, kích hoạt lại không hồi ảnh", async () => {
    expect((await enroll(spare.id)).status).toBe(200);
    const p = await employeeRoute.PATCH(req(`/api/employees/${spare.id}`, { method: "PATCH", cookie: H, body: { active: false } }), ctx({ id: String(spare.id) }));
    expect(p.status).toBe(200);
    expect((await getAvatar(H, spare.id)).status).toBe(404);
    expect((await listRow(H, spare.id))!.avatarUrl).toBeNull();
    const back = await employeeRoute.PATCH(req(`/api/employees/${spare.id}`, { method: "PATCH", cookie: H, body: { active: true } }), ctx({ id: String(spare.id) }));
    expect(back.status).toBe(200);
    expect((await getAvatar(H, spare.id)).status).toBe(404);
    expect(files(spare.id)).toEqual([]);
  });

  it("khóa DB bị sửa thành '../x.jpg' → 404, không đọc file ngoài thư mục", async () => {
    mkdirSync(join(dataDir(), "avatars"), { recursive: true });
    writeFileSync(join(dataDir(), "avatars", "x.jpg"), await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } }).jpeg().toBuffer());
    const saved = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } })).faceAvatarKey;
    for (const bad of ["../x.jpg", "..\\x.jpg", "/etc/passwd", "../../facebeo.db"]) {
      await prisma.employee.update({ where: { id: emp.id }, data: { faceAvatarKey: bad } });
      expect((await getAvatar(H, emp.id)).status, bad).toBe(404);
    }
    await prisma.employee.update({ where: { id: emp.id }, data: { faceAvatarKey: saved } });
  });
});

describe("QC ảnh đại diện — đầu vào ảnh", () => {
  it("điểm mốc sát mép (góc trên-trái, dưới-phải, cả ảnh) → vẫn cắt 256×256, không lỗi", async () => {
    const jpeg = Buffer.from(sampleJpegDataUrl().split(",")[1], "base64"); // 1280×1158
    const cases: L[] = [
      [[0, 0], [60, 0], [30, 40], [5, 80], [55, 80]],
      [[1210, 1080], [1280, 1080], [1245, 1120], [1215, 1158], [1275, 1158]],
      [[0, 0], [1280, 0], [640, 579], [0, 1158], [1280, 1158]],
    ];
    for (const lm of cases) {
      const r = await enroll(spare.id, { snapshot: sampleJpegDataUrl(), landmarks: lm });
      expect(r.status, JSON.stringify(lm)).toBe(200);
      expect((await r.json()).avatar, JSON.stringify(lm)).toBe(true);
      const key = (await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey!;
      const m = await sharp(join(dir(spare.id), key)).metadata();
      expect([m.width, m.height]).toEqual([256, 256]);
    }
    void jpeg;
  });

  it("ảnh rất nhỏ (40×40) → vẫn tạo ảnh", async () => {
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const r = await enroll(spare.id, { snapshot: toUrl(tiny), landmarks: [[10, 12], [30, 12], [20, 20], [12, 30], [28, 30]] });
    expect(r.status).toBe(200);
    expect((await r.json()).avatar).toBe(true);
  });

  it("ảnh có EXIF Orientation=6: cắt đúng vùng mặt theo tọa độ điểm mốc (tọa độ pixel gốc)", async () => {
    // Ảnh 1280×800, nền xám, khối đỏ quanh "mặt" ở (1000..1200, 250..450). Điểm mốc theo pixel gốc (như mô hình nhúng dùng raw()).
    const red = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const img = await sharp({ create: { width: 1280, height: 800, channels: 3, background: "#808080" } })
      .composite([{ input: red, left: 1000, top: 250 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(img).metadata()).orientation).toBe(6);
    const lm: L = [[1060, 320], [1140, 320], [1100, 350], [1070, 380], [1130, 380]];
    const r = await enroll(spare.id, { snapshot: toUrl(img), landmarks: lm });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.avatar).toBe(true);
    const key = (await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey!;
    const st = await sharp(join(dir(spare.id), key)).stats();
    expect(st.channels[0].mean).toBeGreaterThan(200); // phần lớn là đỏ
    expect(st.channels[1].mean).toBeLessThan(60);
  });

  it("mẫu FRONT là PNG → 400 (validator), không có ảnh mới", async () => {
    const before = (await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey;
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123" } }).png().toBuffer();
    const r = await enroll(spare.id, { snapshot: "data:image/png;base64," + png.toString("base64"), landmarks: SAMPLE_LANDMARKS });
    expect(r.status).toBe(400);
    // PNG nhưng khai là jpeg
    const r2 = await enroll(spare.id, { snapshot: "data:image/jpeg;base64," + png.toString("base64"), landmarks: SAMPLE_LANDMARKS });
    expect(r2.status).toBe(400);
    // Rác có đầu JPEG hợp lệ
    const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    const r3 = await enroll(spare.id, { snapshot: toUrl(junk), landmarks: SAMPLE_LANDMARKS });
    expect(r3.status).toBe(400);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey).toBe(before);
  });

  it("enroll lại nhưng không cắt được ảnh mới (ảnh 30×30) → không giữ ảnh cũ của lần enroll trước", async () => {
    expect((await enroll(spare.id)).status).toBe(200);
    const old = (await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey;
    expect(old).toBeTruthy();
    const tiny = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const r = await enroll(spare.id, { snapshot: toUrl(tiny), landmarks: [[4, 8], [26, 8], [15, 15], [6, 24], [24, 24]] });
    expect(r.status).toBe(200);
    expect((await r.json()).avatar).toBe(false);
    // Mẫu khuôn mặt đã thay hoàn toàn; ảnh đại diện cũ không còn khớp với dữ liệu hiện tại.
    const now = (await prisma.employee.findUniqueOrThrow({ where: { id: spare.id } })).faceAvatarKey;
    expect(now).toBeNull();
    expect(files(spare.id)).toEqual([]);
  });

  it("2 lần enroll lại đồng thời → chỉ còn đúng 1 file, trùng khóa DB", async () => {
    expect((await enroll(t8.id)).status).toBe(200);
    const rs = await Promise.all([enroll(t8.id), enroll(t8.id), enroll(t8.id)]);
    expect(rs.some((r) => r.status === 200)).toBe(true);
    const key = (await prisma.employee.findUniqueOrThrow({ where: { id: t8.id } })).faceAvatarKey;
    expect(files(t8.id)).toEqual([key]);
  });

  it("xóa tài khoản tạo nhầm đã enroll → xóa thư mục avatars/<id>", async () => {
    const { employee: e } = await createEmployee(
      { code: `QA${Date.now() % 100000}`, name: "QC ảnh tạo nhầm", role: "EMPLOYEE", departmentId: emp.departmentId, defaultShiftId: emp.defaultShiftId } as never,
      null,
    );
    tempEmpId = e.id;
    const r = await enroll(e.id);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(files(e.id).length).toBe(1);
    const d = await employeeRoute.DELETE(req(`/api/employees/${e.id}`, { method: "DELETE", cookie: A }), ctx({ id: String(e.id) }));
    expect(d.status, JSON.stringify(await d.clone().json())).toBe(200);
    expect(existsSync(dir(e.id))).toBe(false);
    expect(await prisma.employee.findUnique({ where: { id: e.id } })).toBeNull();
    tempEmpId = null;
  });
});
