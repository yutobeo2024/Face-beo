import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { __setFaceEmbedTestHook } from "@/lib/face-embed";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { FACE_MODEL_VERSION } from "@/lib/roles";
import { byCode, ctx, fakeEmbedding, pairedDevice, req, SAMPLE_LANDMARKS, sampleJpegDataUrl, scanPayload, sessionCookie } from "./helpers";

import * as facesRoute from "@/app/api/employees/[id]/faces/route";
import * as scanRoute from "@/app/api/kiosk/scan/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, a: E, b: E;
let A: string, H: string;
const POSES = ["FRONT", "LEFT", "RIGHT", "UP", "DOWN"];
const samples = () => POSES.map((pose) => ({ pose, faceSize: 260, snapshot: sampleJpegDataUrl(), landmarks: SAMPLE_LANDMARKS }));
const enroll = (cookie: string, e: E, force = false) =>
  facesRoute.POST(req(`/api/employees/${e.id}/faces`, { method: "POST", cookie, body: { samples: samples(), force } }), ctx({ id: String(e.id) }));
const frames = (v: number) => Array.from({ length: 5 }, () => ({ real: v, live: v }));
/** Hook trả embedding theo thứ tự gọi (mỗi mẫu enroll một vector). */
const sequence = (vecs: number[][]) => {
  let i = 0;
  __setFaceEmbedTestHook(() => Float32Array.from(vecs[Math.min(i++, vecs.length - 1)]));
};
const near = (base: number[], k: number) => base.map((x, j) => x + fakeEmbedding(1000 + k)[j] * 0.03);

beforeAll(async () => {
  admin = await byCode("NV001");
  hr = await byCode("NV016");
  a = await byCode("NV013");
  b = await byCode("NV014");
  [A, H] = await Promise.all([admin, hr].map((e) => sessionCookie(e.id)));
  for (const e of [a, b]) {
    await prisma.employee.update({ where: { id: e.id }, data: { biometricConsentAt: new Date() } });
    await prisma.faceTemplate.deleteMany({ where: { employeeId: e.id } });
  }
  invalidateFaceCache();
});

afterAll(() => __setFaceEmbedTestHook(null));

describe("enroll — embedding tính trên server", () => {
  it("thiếu snapshot / điểm mốc => 400; 5 mẫu không phải cùng một người => 400", async () => {
    const bad = await facesRoute.POST(
      req(`/api/employees/${a.id}/faces`, { method: "POST", cookie: H, body: { samples: POSES.map((pose) => ({ pose, faceSize: 260, descriptor: fakeEmbedding(1) })) } }),
      ctx({ id: String(a.id) }),
    );
    expect(bad.status).toBe(400);
    sequence([fakeEmbedding(21), fakeEmbedding(22), fakeEmbedding(23), fakeEmbedding(24), fakeEmbedding(25)]); // 5 người khác nhau
    const res = await enroll(H, a);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("không giống nhau");
    expect(await prisma.faceTemplate.count({ where: { employeeId: a.id } })).toBe(0);
  });

  it("enroll thành công: 5 template phiên bản InsightFace; quét kiosk với cùng khuôn mặt => nhận đúng người", async () => {
    const base = fakeEmbedding(31);
    sequence([1, 2, 3, 4, 5].map((k) => near(base, k)));
    const res = await enroll(H, a);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const tpl = await prisma.faceTemplate.findMany({ where: { employeeId: a.id } });
    expect(tpl).toHaveLength(5);
    expect(tpl.every((t) => t.modelVersion === FACE_MODEL_VERSION)).toBe(true);

    const { cookie } = await pairedDevice("Kiosk InsightFace");
    const body = { ...scanPayload(near(base, 9)), frames: frames(0.95), clientEventId: randomUUID(), capturedAt: new Date().toISOString() };
    const r = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body }), ctx())).json();
    expect(r.result).toBe("OK");
    expect(r.employee.code).toBe(a.code);
  });

  it("khuôn mặt gần trùng nhân viên khác: HR không ghi đè được (409 kể cả force), Quản trị ghi đè được", async () => {
    const base = fakeEmbedding(31); // cùng mặt với a
    sequence([1, 2, 3, 4, 5].map((k) => near(base, k)));
    const r1 = await enroll(H, b);
    expect(r1.status).toBe(409);
    expect((await r1.json()).duplicate?.code).toBe(a.code);
    sequence([1, 2, 3, 4, 5].map((k) => near(base, k)));
    const r2 = await enroll(H, b, true);
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toContain("Chỉ Quản trị");
    expect(await prisma.faceTemplate.count({ where: { employeeId: b.id } })).toBe(0);
    sequence([1, 2, 3, 4, 5].map((k) => near(base, k)));
    const r3 = await enroll(A, b, true);
    expect(r3.status).toBe(200);
    expect((await r3.json()).duplicateWarning).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "FACE_DUPLICATE_WARNING", entityId: String(b.id) } })).toBeGreaterThanOrEqual(3);
  });

  it("quét kiosk: điểm mốc ngoài ảnh => 400; hai người giống nhau (top1 − top2 < biên) => không nhận", async () => {
    const { cookie } = await pairedDevice("Kiosk biên");
    const base = fakeEmbedding(31);
    const body = { ...scanPayload(base), frames: frames(0.95), clientEventId: randomUUID(), capturedAt: new Date().toISOString() };
    // a và b (ghi đè ở test trước) cùng khuôn mặt => mơ hồ => NO_MATCH
    const r = await (await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body }), ctx())).json();
    expect(r.result).toBe("NO_MATCH");
    const bad = await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body: { ...body, clientEventId: randomUUID(), landmarks: [[-5, 10], [60, 10], [30, 40], [10, 80], [50, 80]] } }), ctx());
    expect(bad.status).toBe(400);
  });
});
