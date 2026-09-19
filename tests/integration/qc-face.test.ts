// QC adversarial tests — v1.3 nhận diện khuôn mặt phía server (InsightFace): validator, so khớp, enroll, kiosk.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { __setFaceEmbedTestHook, faceModelPath, type Landmarks5 } from "@/lib/face-embed";
import { getTemplates, invalidateFaceCache, matchAgainst } from "@/lib/face-matcher";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { resetRateLimits } from "@/lib/rate-limit";
import { byCode, ctx, enrollFake, fakeEmbedding, pairedDevice, req, SAMPLE_LANDMARKS, sampleJpegDataUrl, sessionCookie } from "./helpers";

import * as facesRoute from "@/app/api/employees/[id]/faces/route";
import * as scanRoute from "@/app/api/kiosk/scan/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, lan: E, x: E, y: E, w: E, z: E, real: E;
let A: string, H: string, M: string;
let settings0: AppSettings;
let lanConsent0: Date | null;
const SNAP = sampleJpegDataUrl();
const POSES = ["FRONT", "LEFT", "RIGHT", "UP", "DOWN"] as const;
const devices: number[] = [];

// ---------- helpers ----------
const frames = (v = 0.95) => Array.from({ length: 5 }, () => ({ real: v, live: v }));
const hook = (vec: ArrayLike<number> | null) => __setFaceEmbedTestHook(vec ? () => Float32Array.from(vec as number[]) : null);
const sequence = (vecs: number[][]) => {
  let i = 0;
  __setFaceEmbedTestHook(() => Float32Array.from(vecs[Math.min(i++, vecs.length - 1)]));
};
const scanBody = (extra: Record<string, unknown> = {}) => ({
  landmarks: SAMPLE_LANDMARKS,
  snapshot: SNAP,
  frames: frames(),
  clientEventId: randomUUID(),
  capturedAt: new Date().toISOString(),
  ...extra,
});
const scan = (cookie: string, body: unknown) => scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body }), ctx());
const scanJson = async (cookie: string, body: unknown) => {
  const r = await scan(cookie, body);
  return { status: r.status, ...(await r.json()) };
};
const samples = (over: Record<string, unknown> = {}, landmarks: [number, number][] = SAMPLE_LANDMARKS) =>
  POSES.map((pose) => ({ pose, faceSize: 260, snapshot: SNAP, landmarks, ...over }));
const enroll = (cookie: string, empId: number, body: unknown) =>
  facesRoute.POST(req(`/api/employees/${empId}/faces`, { method: "POST", cookie, body }), ctx({ id: String(empId) }));
const enrollJson = async (cookie: string, empId: number, body: unknown) => {
  const r = await enroll(cookie, empId, body);
  return { status: r.status, ...(await r.json()) };
};
const device = async (name: string) => {
  const d = await pairedDevice(name);
  devices.push(d.device.id);
  return d;
};
const counts = async () => ({ logs: await prisma.attendanceLog.count(), audits: await prisma.auditLog.count() });
const matched = (r: { result?: string }) => r.result === "OK" || r.result === "DUPLICATE";
const clearTemplates = async (...ids: number[]) => {
  await prisma.faceTemplate.deleteMany({ where: { employeeId: { in: ids } } });
  invalidateFaceCache();
};

// ---------- đại số tuyến tính để dựng vector có cosine chính xác ----------
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const unit = (v: number[]) => {
  const n = Math.sqrt(dot(v, v));
  return v.map((x) => x / n);
};
/** Vector đơn vị vuông góc với span của `basis` (Gram–Schmidt), hướng ngẫu nhiên theo seed. */
function orthoTo(basis: ArrayLike<number>[], seed: number): number[] {
  const ob: number[][] = [];
  for (const b of basis) {
    let v = Array.from(b);
    for (const o of ob) {
      const d = dot(v, o);
      v = v.map((xx, i) => xx - d * o[i]);
    }
    if (Math.sqrt(dot(v, v)) > 1e-6) ob.push(unit(v));
  }
  let r = fakeEmbedding(seed);
  for (const o of ob) {
    const d = dot(r, o);
    r = r.map((xx, i) => xx - d * o[i]);
  }
  return unit(r);
}
const templatesOf = async (empId: number) => (await getTemplates()).filter((e) => e.employeeId === empId).map((e) => e.vec);
/** Vector có cosine đúng bằng `c` với template tốt nhất của nhân viên (các template còn lại của họ thấp hơn). */
async function atCosine(empId: number, c: number, seed = 777) {
  const t = await templatesOf(empId);
  expect(t.length, `nhân viên ${empId} phải có template`).toBeGreaterThan(0);
  const u = Array.from(t[0]);
  const wv = orthoTo(t, seed);
  return u.map((xx, i) => c * xx + Math.sqrt(1 - c * c) * wv[i]);
}

beforeAll(async () => {
  admin = await byCode("NV001");
  mgr = await byCode("NV002"); // MANAGER phòng Hành chính
  lan = await byCode("NV007"); // EMPLOYEE phòng Hành chính (cùng phòng với MANAGER)
  x = await byCode("NV009");
  y = await byCode("NV010");
  w = await byCode("NV011");
  z = await byCode("NV012");
  real = await byCode("NV008");
  hr = await byCode("NV016");
  [A, H, M] = await Promise.all([admin, hr, mgr].map((e) => sessionCookie(e.id)));
  settings0 = await getSettings();
  lanConsent0 = lan.biometricConsentAt;
  for (const e of [x, y, w, z, real]) await prisma.employee.update({ where: { id: e.id }, data: { biometricConsentAt: new Date(), active: true } });
  await clearTemplates(x.id, y.id, w.id, z.id, real.id, lan.id); // file test khác có thể đã enroll NV007
  resetRateLimits();
});

afterAll(async () => {
  __setFaceEmbedTestHook(null);
  await saveSettings(settings0);
  await prisma.employee.update({ where: { id: lan.id }, data: { biometricConsentAt: lanConsent0 } });
  await prisma.employee.update({ where: { id: w.id }, data: { active: true } });
  await clearTemplates(x.id, y.id, w.id, z.id, real.id);
  if (devices.length) await prisma.attendanceLog.deleteMany({ where: { deviceId: { in: devices } } });
  resetRateLimits();
});

// =====================================================================================
describe("validator kiosk/scan: dữ liệu xấu => 400, không ghi log chấm công / audit", () => {
  let cookie: string;
  beforeAll(async () => {
    cookie = (await device("QC validator")).cookie;
    hook(fakeEmbedding(900)); // nếu validator lọt, hook trả vector => sẽ lộ ra qua NO_MATCH/audit
  });

  const cases: [string, Record<string, unknown>][] = [
    ["landmarks 4 điểm", { landmarks: SAMPLE_LANDMARKS.slice(0, 4) }],
    ["landmarks 6 điểm", { landmarks: [...SAMPLE_LANDMARKS, [600, 500]] }],
    ["landmarks NaN (JSON => null)", { landmarks: [[NaN, 400], ...SAMPLE_LANDMARKS.slice(1)] }],
    ["landmarks Infinity (JSON => null)", { landmarks: [[Infinity, 400], ...SAMPLE_LANDMARKS.slice(1)] }],
    ["landmarks âm", { landmarks: [[-1, 400], ...SAMPLE_LANDMARKS.slice(1)] }],
    ["landmarks chuỗi", { landmarks: [["560", "400"], ...SAMPLE_LANDMARKS.slice(1)] }],
    ["landmarks điểm 3 tọa độ", { landmarks: SAMPLE_LANDMARKS.map((p) => [...p, 0]) }],
    ["landmarks là object", { landmarks: { leftEye: [560, 400] } }],
    ["landmarks null", { landmarks: null }],
    ["thiếu landmarks", { landmarks: undefined }],
    ["thiếu snapshot", { snapshot: undefined }],
    ["snapshot rỗng", { snapshot: "" }],
    ["snapshot PNG data URL", { snapshot: "data:image/png;base64," + SNAP.slice("data:image/jpeg;base64,".length) }],
    ["snapshot base64 trần (không prefix)", { snapshot: SNAP.slice("data:image/jpeg;base64,".length) }],
    ["snapshot > 1.5 MB ký tự", { snapshot: "data:image/jpeg;base64," + "A".repeat(1_600_000) }],
    ["snapshot 1.1 MB JPEG bytes (qua validator, storage chặn)", { snapshot: "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_100_000)]).toString("base64") }],
    ["snapshot prefix JPEG nhưng bytes PNG", { snapshot: "data:image/jpeg;base64," + Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64") }],
    ["snapshot base64 có ký tự lạ", { snapshot: "data:image/jpeg;base64,/9j/4AAQ$$$" }],
    ["frames rỗng", { frames: [] }],
    ["frames 11 khung", { frames: frames().concat(frames(), { real: 1, live: 1 }) }],
    ["frames điểm > 1", { frames: [{ real: 1.2, live: 0.9 }] }],
    ["clientEventId không phải uuid", { clientEventId: "abc" }],
    ["capturedAt không ISO", { capturedAt: "hôm nay" }],
    ["faceBox w = 0", { faceBox: [10, 10, 0, 50] }],
    ["faceBox không chứa điểm mốc (L2 và nhận diện phải cùng một mặt)", { faceBox: [0, 0, 100, 100] }],
    ["faceBox quá rộng so với khoảng cách mắt (60px vs khung 1000px)", { faceBox: [200, 100, 1000, 1000] }],
    ["faceBox quá hẹp so với khoảng cách mắt (60px vs khung 60px => > 0.8w)", { faceBox: [555, 390, 60, 100] }],
    ["điểm mốc x > W (1281)", { landmarks: [[1281, 400], ...SAMPLE_LANDMARKS.slice(1)] }],
    ["mắt cách 10px", { landmarks: [[560, 400], [570, 400], [565, 410], [560, 420], [570, 420]] }],
  ];

  for (const [name, extra] of cases) {
    it(`${name} => 400`, async () => {
      const before = await counts();
      const r = await scan(cookie, scanBody(extra));
      const j = await r.json();
      expect(r.status, JSON.stringify(j).slice(0, 300)).toBe(400);
      expect(await counts()).toEqual(before);
    });
  }

  it("định dạng cũ {embedding:[...]} => 400 báo kiosk bản cũ + audit KIOSK_OUTDATED (không log chấm công)", async () => {
    const logs = await prisma.attendanceLog.count();
    const r = await scan(cookie, scanBody({ landmarks: undefined, snapshot: undefined, embedding: fakeEmbedding(1) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("bản cũ");
    expect(await prisma.attendanceLog.count()).toBe(logs);
    expect(await prisma.auditLog.count({ where: { action: "KIOSK_OUTDATED" } })).toBeGreaterThanOrEqual(1);
    // có cả landmarks lẫn embedding => không coi là bản cũ, đi tiếp validator bình thường
    const r2 = await scan(cookie, scanBody({ embedding: fakeEmbedding(1) }));
    expect(r2.status).toBe(200);
  });

  it("faceBox hợp lệ bao quanh điểm mốc => qua validator (200)", async () => {
    const r = await scanJson(cookie, scanBody({ faceBox: [520, 360, 130, 160] }));
    expect(r.status, JSON.stringify(r)).toBe(200);
  });

  it("body không phải JSON => 400", async () => {
    const before = await counts();
    const r = await scanRoute.POST(
      req("/api/kiosk/scan", { method: "POST", cookie, headers: { "content-type": "application/json" }, body: undefined }),
      ctx(),
    );
    expect(r.status).toBe(400);
    expect(await counts()).toEqual(before);
  });
});

// =====================================================================================
describe("so khớp: ngưỡng, biên top1−top2, cài đặt đổi có hiệu lực ngay", () => {
  let cookie: string;
  let baseX: number[], baseY: number[];
  beforeAll(async () => {
    cookie = (await device("QC matching")).cookie;
    baseX = await enrollFake(x.id, 501);
    baseY = await enrollFake(y.id, 502);
    await saveSettings({ matchThreshold: 0.45, matchMargin: 0.08 });
  });
  afterAll(async () => {
    await saveSettings({ matchThreshold: settings0.matchThreshold, matchMargin: settings0.matchMargin });
  });

  it("quét đúng vector gốc => OK đúng người; y không bị nhận nhầm", async () => {
    hook(baseX);
    const r = await scanJson(cookie, scanBody());
    expect(r.result, JSON.stringify(r)).toBe("OK");
    expect(r.employee.code).toBe(x.code);
    hook(baseY);
    const r2 = await scanJson(cookie, scanBody());
    expect(r2.result).toBe("OK");
    expect(r2.employee.code).toBe(y.code);
  });

  it("cosine = ngưỡng − 0.01 => NO_MATCH (audit ghi top1 ≈ 0.44); ngưỡng + 0.01 => nhận", async () => {
    const q = await atCosine(x.id, 0.44);
    const pre = matchAgainst(await getTemplates(), q, 0.45, 0.08);
    expect(pre.top1).toBeCloseTo(0.44, 3);
    expect(pre.top1EmployeeId).toBe(x.id);
    hook(q);
    const before = await prisma.auditLog.count({ where: { action: "SCAN_NO_MATCH" } });
    const r = await scanJson(cookie, scanBody());
    expect(r.result).toBe("NO_MATCH");
    expect(await prisma.auditLog.count({ where: { action: "SCAN_NO_MATCH" } })).toBe(before + 1);
    const last = await prisma.auditLog.findFirst({ where: { action: "SCAN_NO_MATCH" }, orderBy: { id: "desc" } });
    const detail = JSON.parse(String(last?.detail ?? "{}"));
    expect(detail.top1).toBeCloseTo(0.44, 2);
    expect(detail.candidate).toBe(x.id);

    hook(await atCosine(x.id, 0.46));
    const r2 = await scanJson(cookie, scanBody());
    expect(matched(r2), JSON.stringify(r2)).toBe(true);
    expect(r2.employee.code).toBe(x.code);
  });

  it("hai nhân viên cùng điểm cao (top1 − top2 < 0.08) => NO_MATCH", async () => {
    const [tx] = await templatesOf(x.id);
    const [ty] = await templatesOf(y.id);
    const q = unit(Array.from(tx).map((v, i) => 0.6 * v + 0.6 * ty[i]));
    const pre = matchAgainst(await getTemplates(), q, 0.45, 0.08);
    expect(pre.top1).toBeGreaterThanOrEqual(0.45);
    expect(pre.top1 - pre.top2).toBeLessThan(0.08);
    hook(q);
    const r = await scanJson(cookie, scanBody());
    expect(r.result, JSON.stringify(pre)).toBe("NO_MATCH");
    // nới biên về 0 => nhận (chứng tỏ chính margin là nguyên nhân)
    await saveSettings({ matchMargin: 0 });
    const r2 = await scanJson(cookie, scanBody());
    expect(matched(r2), JSON.stringify(r2)).toBe(true);
    await saveSettings({ matchMargin: 0.08 });
  });

  it("đổi matchThreshold qua saveSettings có hiệu lực ngay (không phụ thuộc cache template)", async () => {
    const q = await atCosine(x.id, 0.55, 778);
    hook(q);
    const r1 = await scanJson(cookie, scanBody());
    expect(matched(r1), JSON.stringify(r1)).toBe(true);
    await saveSettings({ matchThreshold: 0.6 });
    const r2 = await scanJson(cookie, scanBody());
    expect(r2.result).toBe("NO_MATCH");
    await saveSettings({ matchThreshold: 0.45 });
    const r3 = await scanJson(cookie, scanBody());
    expect(matched(r3)).toBe(true);
    expect(r3.employee.code).toBe(x.code);
  });

  it("vector 128 chiều (định dạng cũ face-api) => không khớp ai (cosine = −1), không 500", async () => {
    hook(fakeEmbedding(3, 128));
    const r = await scanJson(cookie, scanBody());
    expect(r.status).toBe(200);
    expect(r.result).toBe("NO_MATCH");
  });

  it("template của nhân viên đã nghỉ (active=false) bị bỏ qua khi so khớp", async () => {
    await prisma.employee.update({ where: { id: y.id }, data: { active: false } });
    invalidateFaceCache();
    hook(baseY);
    const r = await scanJson(cookie, scanBody());
    expect(r.result).toBe("NO_MATCH");
    // cache cũ chưa invalidate (nghỉ việc trực tiếp trong DB): route vẫn phải chặn vì kiểm tra emp.active
    await prisma.employee.update({ where: { id: y.id }, data: { active: true } });
    invalidateFaceCache();
    await getTemplates();
    await prisma.employee.update({ where: { id: y.id }, data: { active: false } });
    const r2 = await scanJson(cookie, scanBody());
    expect(r2.result).toBe("NO_MATCH");
    await prisma.employee.update({ where: { id: y.id }, data: { active: true } });
    invalidateFaceCache();
  });
});

// =====================================================================================
describe("enroll: quyền, đồng ý, kích thước mặt, thay thế template, trùng người khác", () => {
  beforeAll(async () => {
    await saveSettings({ matchThreshold: 0.45, matchMargin: 0.08 });
    await clearTemplates(w.id, z.id);
  });
  beforeEach(() => resetRateLimits()); // enroll giới hạn 10 lượt/phút/người dùng
  afterAll(async () => {
    await saveSettings({ matchThreshold: settings0.matchThreshold, matchMargin: settings0.matchMargin });
  });
  const faceW = fakeEmbedding(601);

  it("5 mẫu pose khác nhau nhưng cùng snapshot => 200, 5 template", async () => {
    hook(faceW);
    const r = await enrollJson(H, w.id, { samples: samples() });
    expect(r.status, JSON.stringify(r)).toBe(200);
    expect(r.count).toBe(5);
    expect(r.duplicateWarning).toBe(false);
    expect(await prisma.faceTemplate.count({ where: { employeeId: w.id } })).toBe(5);
  });

  it("một mẫu faceSize 199 => 400, template cũ giữ nguyên; 5 mẫu trùng pose => 400", async () => {
    hook(faceW);
    const ids0 = (await prisma.faceTemplate.findMany({ where: { employeeId: w.id }, select: { id: true } })).map((t) => t.id);
    const s = samples();
    s[2] = { ...s[2], faceSize: 199 };
    const r = await enrollJson(H, w.id, { samples: s });
    expect(r.status).toBe(400);
    expect(r.error).toContain("200px");
    const s2 = samples().map((m) => ({ ...m, pose: "FRONT" }));
    const r2 = await enrollJson(H, w.id, { samples: s2 });
    expect(r2.status).toBe(400);
    const ids1 = (await prisma.faceTemplate.findMany({ where: { employeeId: w.id }, select: { id: true } })).map((t) => t.id);
    expect(ids1).toEqual(ids0);
  });

  it("faceSize âm / thiếu pose / 4 mẫu / 6 mẫu => 400", async () => {
    hook(faceW);
    for (const body of [
      { samples: samples({ faceSize: -1 }) },
      { samples: samples().map((m) => ({ ...m, pose: undefined })) },
      { samples: samples().slice(0, 4) },
      { samples: [...samples(), samples()[0]] },
      { samples: samples({ landmarks: SAMPLE_LANDMARKS.slice(0, 3) }) },
    ]) {
      const r = await enrollJson(H, w.id, body);
      expect(r.status, JSON.stringify(body).slice(0, 120)).toBe(400);
    }
  });

  it("nhân viên chưa đồng ý sinh trắc => 403 (không tạo template)", async () => {
    await prisma.employee.update({ where: { id: lan.id }, data: { biometricConsentAt: null } });
    hook(fakeEmbedding(602));
    const r = await enrollJson(H, lan.id, { samples: samples() });
    expect(r.status).toBe(403);
    expect(await prisma.faceTemplate.count({ where: { employeeId: lan.id } })).toBe(0);
  });

  it("MANAGER (không có faces.enroll) => 403 kể cả với nhân viên phòng mình", async () => {
    await prisma.employee.update({ where: { id: lan.id }, data: { biometricConsentAt: new Date() } });
    hook(fakeEmbedding(602));
    const r = await enrollJson(M, lan.id, { samples: samples() });
    expect(r.status).toBe(403);
    expect(await prisma.faceTemplate.count({ where: { employeeId: lan.id } })).toBe(0);
    await prisma.employee.update({ where: { id: lan.id }, data: { biometricConsentAt: null } });
  });

  it("HR enroll cho ADMIN => 403; HR tự enroll => 403; MANAGER xóa mặt => 403", async () => {
    hook(fakeEmbedding(603));
    await prisma.employee.update({ where: { id: admin.id }, data: { biometricConsentAt: new Date() } });
    const adminTpl = await prisma.faceTemplate.findMany({ where: { employeeId: admin.id }, select: { id: true } });
    const r = await enrollJson(H, admin.id, { samples: samples() });
    expect(r.status).toBe(403);
    expect(await prisma.faceTemplate.findMany({ where: { employeeId: admin.id }, select: { id: true } })).toEqual(adminTpl);
    await prisma.employee.update({ where: { id: hr.id }, data: { biometricConsentAt: new Date() } });
    const r2 = await enrollJson(H, hr.id, { samples: samples() });
    expect(r2.status).toBe(403);
    const del = await facesRoute.DELETE(req(`/api/employees/${lan.id}/faces`, { method: "DELETE", cookie: M }), ctx({ id: String(lan.id) }));
    expect(del.status).toBe(403);
  });

  it("enroll lại thay thế trọn bộ: vẫn 5 template, id cũ biến mất", async () => {
    const before = (await prisma.faceTemplate.findMany({ where: { employeeId: w.id }, select: { id: true } })).map((t) => t.id);
    expect(before).toHaveLength(5);
    hook(faceW.map((v, i) => v + fakeEmbedding(604)[i] * 0.02));
    const r = await enrollJson(H, w.id, { samples: samples() });
    expect(r.status).toBe(200);
    const after = (await prisma.faceTemplate.findMany({ where: { employeeId: w.id }, select: { id: true } })).map((t) => t.id);
    expect(after).toHaveLength(5);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
  });

  it("kiểm tra trùng bỏ qua template cũ của chính mình: enroll lại đúng mặt cũ => 200, không 409", async () => {
    hook(faceW);
    const r = await enrollJson(H, w.id, { samples: samples() });
    expect(r.status, JSON.stringify(r)).toBe(200);
    expect(r.duplicateWarning).toBe(false);
  });

  it("trùng mềm (cosine 0.50 với người khác): 409 có duplicate.hard=false; HR force => 200 + cảnh báo + audit", async () => {
    const q = await atCosine(w.id, 0.5, 611);
    hook(q);
    const r = await enrollJson(H, z.id, { samples: samples() });
    expect(r.status).toBe(409);
    expect(r.duplicate?.employeeId).toBe(w.id);
    expect(r.duplicate?.hard).toBe(false);
    expect(r.duplicate?.score).toBeCloseTo(0.5, 2);
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
    const r2 = await enrollJson(H, z.id, { samples: samples(), force: true });
    expect(r2.status).toBe(200);
    expect(r2.duplicateWarning).toBe(true);
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(5);
    const a = await prisma.auditLog.findFirst({ where: { action: "FACE_DUPLICATE_WARNING", entityId: String(z.id) }, orderBy: { id: "desc" } });
    expect(JSON.parse(String(a?.detail))).toMatchObject({ otherEmployeeId: w.id, forced: true });
    await clearTemplates(z.id);
  });

  it("trùng cứng (cosine 0.70): HR 409 kể cả force; ADMIN force => 200", async () => {
    const q = await atCosine(w.id, 0.7, 612);
    hook(q);
    const r = await enrollJson(H, z.id, { samples: samples(), force: true });
    expect(r.status).toBe(409);
    expect(r.duplicate?.hard).toBe(true);
    expect(r.error).toContain("Chỉ Quản trị");
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
    const r2 = await enrollJson(A, z.id, { samples: samples() });
    expect(r2.status).toBe(409); // ADMIN không force cũng 409
    const r3 = await enrollJson(A, z.id, { samples: samples(), force: true });
    expect(r3.status).toBe(200);
    expect(r3.duplicateWarning).toBe(true);
    await clearTemplates(z.id);
  });

  it("biên trùng cứng: 0.649 => mềm (HR force được); 0.651 => cứng", async () => {
    hook(await atCosine(w.id, 0.649, 613));
    const r = await enrollJson(H, z.id, { samples: samples(), force: true });
    expect(r.status).toBe(200);
    await clearTemplates(z.id);
    hook(await atCosine(w.id, 0.651, 614));
    const r2 = await enrollJson(H, z.id, { samples: samples(), force: true });
    expect(r2.status).toBe(409);
    expect(r2.duplicate?.hard).toBe(true);
  });

  it("force không phải boolean => 400; force='true' chuỗi không được coi là ghi đè", async () => {
    hook(await atCosine(w.id, 0.5, 615));
    const r = await enrollJson(H, z.id, { samples: samples(), force: "true" });
    expect(r.status).toBe(400);
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
  });

  it("nhân viên đã nghỉ: template không tính khi so khớp và không gây 409 trùng cho người khác", async () => {
    await prisma.employee.update({ where: { id: w.id }, data: { active: false } });
    invalidateFaceCache();
    const { cookie } = await device("QC inactive");
    hook(faceW);
    const r = await scanJson(cookie, scanBody());
    expect(r.result).toBe("NO_MATCH");
    hook(faceW); // đúng mặt của w (cosine ≈ 1) — w đã nghỉ nên không được tính là trùng
    const r2 = await enrollJson(H, z.id, { samples: samples() });
    expect(r2.status, JSON.stringify(r2)).toBe(200);
    expect(r2.duplicateWarning).toBe(false);
    await prisma.employee.update({ where: { id: w.id }, data: { active: true } });
    await clearTemplates(z.id);
  });

  it("enroll cho nhân viên đã nghỉ => 404; id không hợp lệ => 400", async () => {
    await prisma.employee.update({ where: { id: z.id }, data: { active: false } });
    hook(fakeEmbedding(620));
    const r = await enrollJson(H, z.id, { samples: samples() });
    expect(r.status).toBe(404);
    await prisma.employee.update({ where: { id: z.id }, data: { active: true } });
    const r2 = await facesRoute.POST(req(`/api/employees/abc/faces`, { method: "POST", cookie: H, body: { samples: samples() } }), ctx({ id: "abc" }));
    expect(r2.status).toBe(400);
  });

  // Tại commit 18a5f80 hai trường hợp dưới trả 503 (HttpError 400 của decodeJpegDataUrl bị bọc lại); đã sửa trong cây làm việc.
  it("enroll: snapshot prefix JPEG nhưng bytes PNG => 400 (không phải 503)", async () => {
    hook(fakeEmbedding(621));
    const png = "data:image/jpeg;base64," + Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
    const r = await enrollJson(H, z.id, { samples: samples({ snapshot: png }) });
    expect(r.status, JSON.stringify(r)).toBe(400);
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
  });

  it("enroll: snapshot 1.1 MB (qua validator 1.5M ký tự) => 400 'vượt quá 1 MB' (không phải 503)", async () => {
    hook(fakeEmbedding(622));
    const big = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_100_000)]).toString("base64");
    const r = await enrollJson(H, z.id, { samples: samples({ snapshot: big }) });
    expect(r.status, JSON.stringify(r).slice(0, 200)).toBe(400);
  });

  it("enroll: JPEG hỏng (magic đúng, rác) => 400 nêu pose, không 503", async () => {
    hook(fakeEmbedding(623));
    const bad = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64");
    const s = samples();
    s[1] = { ...s[1], snapshot: bad };
    const r = await enrollJson(H, z.id, { samples: s });
    expect(r.status, JSON.stringify(r)).toBe(400);
    expect(r.error).toContain("LEFT");
  });

  it("enroll: điểm mốc ngoài ảnh / mắt quá nhỏ => 400 nêu pose (validate chạy trước hook)", async () => {
    hook(fakeEmbedding(624));
    for (const [lm, re] of [
      [[[1281, 400], ...SAMPLE_LANDMARKS.slice(1)], /ngoài ảnh/],
      [[[560, 400], [570, 400], [565, 410], [560, 420], [570, 420]], /quá nhỏ/],
    ] as [number[][], RegExp][]) {
      const s = samples();
      s[4] = { ...s[4], landmarks: lm as [number, number][] };
      const r = await enrollJson(H, z.id, { samples: s });
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/DOWN/);
      expect(r.error).toMatch(re);
    }
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
  });

  it("giới hạn 30 lượt enroll/phút/người: lượt 31 => 429 (kể cả body hợp lệ); tài khoản khác không bị ảnh hưởng", async () => {
    hook(fakeEmbedding(625));
    for (let i = 0; i < 30; i++) expect((await enroll(H, z.id, { samples: [] })).status).toBe(400);
    const r = await enrollJson(H, z.id, { samples: samples() });
    expect(r.status).toBe(429);
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
    const r2 = await enrollJson(A, z.id, { samples: samples() });
    expect(r2.status, JSON.stringify(r2)).toBe(200);
    await clearTemplates(z.id);
  });

  it("5 mẫu là 5 người khác nhau => 400 (tự nhất quán); mẫu 4 và 5 lệch => 400 nêu đúng cặp pose", async () => {
    const base = fakeEmbedding(630);
    sequence([base, base, base, fakeEmbedding(631), base]);
    const r = await enrollJson(H, z.id, { samples: samples() });
    expect(r.status).toBe(400);
    expect(r.error).toContain("UP");
    expect(await prisma.faceTemplate.count({ where: { employeeId: z.id } })).toBe(0);
  });
});

// =====================================================================================
describe("kiosk: giới hạn tần suất, capturedAt, idempotent, thiết bị", () => {
  it("61 lượt trong 1 phút => 429 (kể cả request hợp lệ sau đó)", async () => {
    const { cookie } = await device("QC rate");
    hook(fakeEmbedding(700));
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const r = await scan(cookie, { nope: true });
      last = r.status;
      expect(last, `lượt ${i + 1}`).toBe(400);
    }
    const r = await scan(cookie, scanBody());
    expect(r.status).toBe(429);
    const r2 = await scan(cookie, { nope: true });
    expect(r2.status).toBe(429);
  });

  it("capturedAt quá 24 giờ => 400; tương lai > 5 phút => 400; đúng 23h59 => chấp nhận", async () => {
    const { cookie } = await device("QC capturedAt");
    hook(fakeEmbedding(701)); // không khớp ai => NO_MATCH nhưng đã qua kiểm tra thời gian
    const old = await scan(cookie, scanBody({ capturedAt: new Date(Date.now() - 25 * 3600_000).toISOString() }));
    expect(old.status).toBe(400);
    expect((await old.json()).error).toContain("24 giờ");
    const fut = await scan(cookie, scanBody({ capturedAt: new Date(Date.now() + 10 * 60_000).toISOString() }));
    expect(fut.status).toBe(400);
    const ok = await scanJson(cookie, scanBody({ capturedAt: new Date(Date.now() - (24 * 3600_000 - 60_000)).toISOString() }));
    expect(ok.status).toBe(200);
    expect(ok.result).toBe("NO_MATCH");
  });

  it("clientEventId trùng => trả lại kết quả cũ (duplicateEvent), không tạo log thứ hai", async () => {
    const { cookie } = await device("QC idempotent");
    const base = await enrollFake(x.id, 501);
    hook(base);
    const id = randomUUID();
    // capturedAt lùi 30 phút để không dính khử trùng ±2 phút với các lượt quét của x ở test trước.
    const body = scanBody({ clientEventId: id, capturedAt: new Date(Date.now() - 30 * 60_000).toISOString() });
    const r1 = await scanJson(cookie, body);
    expect(r1.result, JSON.stringify(r1)).toBe("OK");
    const r2 = await scanJson(cookie, body);
    expect(r2.result).toBe("OK");
    expect(r2.duplicateEvent).toBe(true);
    expect(r2.employee.code).toBe(x.code);
    expect(await prisma.attendanceLog.count({ where: { clientEventId: id } })).toBe(1);
    // cùng clientEventId nhưng vector người khác: vẫn trả bản ghi cũ (không đổi chủ)
    hook(fakeEmbedding(702));
    const r3 = await scanJson(cookie, body);
    expect(r3.duplicateEvent).toBe(true);
    expect(r3.employee.code).toBe(x.code);
    expect(await prisma.attendanceLog.count({ where: { clientEventId: id } })).toBe(1);
  });

  it("liveness thấp => REJECTED_SPOOF (cờ client bị bỏ qua), không ghi log chấm công", async () => {
    const { cookie } = await device("QC spoof");
    hook(await enrollFake(x.id, 501));
    const before = await prisma.attendanceLog.count();
    const r = await scanJson(cookie, scanBody({ frames: frames(0.2), verified: true, liveness: true }));
    expect(r.result).toBe("REJECTED_SPOOF");
    expect(await prisma.attendanceLog.count()).toBe(before);
  });

  it("thiết bị bị thu hồi => 401; không token => 401", async () => {
    const d = await device("QC revoked");
    await prisma.kioskDevice.update({ where: { id: d.device.id }, data: { active: false } });
    hook(fakeEmbedding(703));
    expect((await scan(d.cookie, scanBody())).status).toBe(401);
    expect((await scan("", scanBody())).status).toBe(401);
  });
});

// =====================================================================================
describe.skipIf(!existsSync(faceModelPath()))("pipeline thật (ONNX) qua route: ảnh samples.jpg của Human", () => {
  // Hai khuôn mặt trong ảnh nhóm (tọa độ pixel ảnh 1280×1158): F1 cô gái tóc vàng, F2 cô gái bên phải.
  const F1: Landmarks5 = [[305, 530], [333, 527], [322, 545], [310, 557], [337, 555]];
  const F1_JIT: Landmarks5 = [[307, 531], [335, 528], [323, 546], [311, 558], [338, 556]];
  const F2: Landmarks5 = [[557, 517], [587, 520], [570, 540], [560, 557], [583, 555]];
  const BG: Landmarks5 = [[900, 300], [940, 300], [920, 330], [905, 355], [935, 355]];
  const TINY: Landmarks5 = [[320, 530], [330, 530], [325, 540], [320, 550], [330, 550]];
  let cookie: string;
  beforeAll(async () => {
    __setFaceEmbedTestHook(null);
    resetRateLimits();
    cookie = (await device("QC real model")).cookie;
    await saveSettings({ matchThreshold: 0.45, matchMargin: 0.08 });
    await clearTemplates(real.id);
  });
  afterAll(async () => {
    await saveSettings({ matchThreshold: settings0.matchThreshold, matchMargin: settings0.matchMargin });
  });

  it("enroll F1 (5 pose, cùng ảnh) => 200; quét F1 hơi lệch => OK đúng người; quét F2 => NO_MATCH; nền => NO_MATCH", async () => {
    const r = await enrollJson(H, real.id, { samples: samples({}, F1) });
    expect(r.status, JSON.stringify(r)).toBe(200);
    const s1 = await scanJson(cookie, scanBody({ landmarks: F1_JIT }));
    expect(s1.result, JSON.stringify(s1)).toBe("OK");
    expect(s1.employee.code).toBe(real.code);
    expect(s1.type).toBe("IN");
    const s2 = await scanJson(cookie, scanBody({ landmarks: F2 }));
    expect(s2.result, JSON.stringify(s2)).toBe("NO_MATCH");
    const s3 = await scanJson(cookie, scanBody({ landmarks: BG }));
    expect(s3.status).toBe(200);
    expect(s3.result).toBe("NO_MATCH");
  });

  it("mắt cách nhau 10px => 400 'Mặt quá nhỏ'; x = W+1 => 400 'ngoài ảnh'; x = W đúng biên => chấp nhận", async () => {
    const before = await counts();
    const r = await scanJson(cookie, scanBody({ landmarks: TINY }));
    expect(r.status).toBe(400);
    expect(r.error).toContain("Mặt quá nhỏ");
    const r2 = await scanJson(cookie, scanBody({ landmarks: [[1281, 500], [1240, 500], [1260, 530], [1245, 560], [1275, 560]] }));
    expect(r2.status).toBe(400);
    expect(r2.error).toContain("ngoài ảnh");
    expect(await counts()).toEqual(before);
    const r3 = await scanJson(cookie, scanBody({ landmarks: [[1240, 1118], [1280, 1118], [1260, 1148], [1240, 1158], [1280, 1158]] }));
    expect(r3.status).toBe(200);
    expect(r3.result).toBe("NO_MATCH");
  });

  it("enroll: mẫu có mặt quá nhỏ => 400 nêu pose; mẫu đảo mắt => 400 'bố cục'; template cũ giữ nguyên", async () => {
    const s = samples({}, F1);
    s[3] = { ...s[3], landmarks: TINY };
    const r = await enrollJson(H, real.id, { samples: s });
    expect(r.status).toBe(400);
    expect(r.error).toContain("UP");
    const s2 = samples({}, F1);
    s2[1] = { ...s2[1], landmarks: [F1[1], F1[0], F1[2], F1[3], F1[4]] };
    const r2 = await enrollJson(H, real.id, { samples: s2 });
    expect(r2.status).toBe(400);
    expect(r2.error).toMatch(/LEFT.*bố cục/);
    expect(await prisma.faceTemplate.count({ where: { employeeId: real.id } })).toBe(5);
  });

  it("quét: điểm mốc đảo mắt trái/phải => 400 'bố cục' (không ra embedding, không audit, không log)", async () => {
    const before = await counts();
    const r = await scanJson(cookie, scanBody({ landmarks: [F1[1], F1[0], F1[2], F1[3], F1[4]] }));
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/bố cục/);
    expect(await counts()).toEqual(before);
  });

  // Tại commit 18a5f80: 503 + audit FACE_MODEL_ERROR (client điều khiển được cảnh báo "mô hình lỗi"); đã sửa trong cây làm việc.
  it("JPEG hỏng (magic đúng, dữ liệu rác) => 400, không 503, không audit FACE_MODEL_ERROR", async () => {
    const bad = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64");
    const before = await prisma.auditLog.count({ where: { action: "FACE_MODEL_ERROR" } });
    const r = await scanJson(cookie, scanBody({ snapshot: bad }));
    expect(r.status, JSON.stringify(r)).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: "FACE_MODEL_ERROR" } })).toBe(before);
  });
});
