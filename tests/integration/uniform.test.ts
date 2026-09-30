// v1.20.0: kiểm đồng phục ở lượt chấm VÀO đầu ca — job nền, không đụng đường chấm công.
// Mô hình AI được thay bằng hook giả nên test không cần tệp .onnx.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { runJob } from "@/lib/jobs";
import { __setUniformEmbedTestHook, withUniformModel } from "@/lib/uniform-embed";
import { extractSampleFeature } from "@/lib/uniform";
import { pickFirstInLogs } from "@/lib/uniform-service";
import { byCode, ctx, enrollFake, pairedDevice, req, scanPayload } from "./helpers";

import * as scanRoute from "@/app/api/kiosk/scan/route";

const tag = `U${Date.now().toString().slice(-5)}`;
const frames = (v: number) => Array.from({ length: 5 }, () => ({ real: v, live: v }));

type E = Awaited<ReturnType<typeof byCode>>;
let emp: E; // nhân viên phòng có kiểm đồng phục
let other: E; // nhân viên phòng không kiểm
let cookie = "";
let deviceId = 0;
const createdLogs: number[] = [];
const createdTemplates: number[] = [];

/**
 * Ảnh chấm công giả: nền tường, khuôn mặt (màu da) đúng vị trí SAMPLE_FACE_BOX, bên dưới là áo — có thể kèm logo.
 * Ảnh mẫu của Human là chân dung cận, vùng áo toàn da nên không dùng để thử phần đồng phục được.
 */
async function shirtSnapshot(opts: { shirt?: { r: number; g: number; b: number }; logo?: boolean } = {}) {
  const sharp = (await import("sharp")).default;
  const shirt = opts.shirt ?? { r: 30, g: 45, b: 95 };
  const W = 1280;
  const H = 720;
  const px = new Uint8Array(W * H * 3);
  // Ảnh chấm công thật có độ tương phản vùng áo 0,07–0,20 (đo trên 60 ảnh): nhiễu cảm biến + nếp áo + bóng đổ.
  // Ảnh tổng hợp phẳng lì sẽ bị chính hệ thống coi là "mờ, không rõ chi tiết" — nên phải dựng cho giống.
  const noise = (i: number) => ((i * 2654435761) % 29) - 14;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let c = { r: 180, g: 178, b: 176 }; // tường
      if (x >= 520 && x < 670 && y >= 330 && y < 520) c = { r: 205, g: 160, b: 135 }; // khuôn mặt
      else if (x >= 410 && x < 830 && y >= 520) c = shirt; // thân áo
      if (opts.logo !== false && x >= 560 && x < 630 && y >= 600 && y < 650) c = { r: 235, g: 200, b: 60 }; // logo trước ngực
      const shade = Math.round(((y - 520) / 200) * 18); // bóng đổ dần xuống dưới, như đèn chiếu từ trên
      const d = noise(i) + (y >= 520 ? shade : 0);
      px[i] = Math.max(0, Math.min(255, c.r + d));
      px[i + 1] = Math.max(0, Math.min(255, c.g + d));
      px[i + 2] = Math.max(0, Math.min(255, c.b + d));
    }
  }
  const buf = await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Quét kiosk cho một người tại thời điểm cho trước (ảnh mẫu + khung mặt giống kiosk thật). */
async function scan(e: E, at: Date, base: number[], opts: { faceBox?: [number, number, number, number] | null; snapshot?: string } = {}) {
  const body = { ...scanPayload(base, opts), ...(opts.snapshot ? { snapshot: opts.snapshot } : {}), frames: frames(0.95), clientEventId: randomUUID(), capturedAt: at.toISOString() };
  const res = await scanRoute.POST(req("/api/kiosk/scan", { method: "POST", cookie, body }), ctx());
  const j = await res.json();
  const log = await prisma.attendanceLog.findFirst({ where: { employeeId: e.id }, orderBy: { id: "desc" } });
  if (log) createdLogs.push(log.id);
  return { result: j.result as string, log };
}

/** Một mẫu áo của phòng, có sẵn đặc trưng (không cần ảnh thật). */
async function makeTemplate(departmentId: number, name: string, opts: { hue?: number; pattern?: number; samples?: number; active?: boolean } = {}) {
  const hue = opts.hue ?? 10;
  const hist = new Array(99).fill(0);
  hist[hue % 96] = 1;
  const t = await prisma.uniformTemplate.create({
    data: {
      departmentId,
      name,
      active: opts.active ?? true,
      colorHist: JSON.stringify({ hist, pattern: opts.pattern ?? 0.12 }),
      embedding: JSON.stringify(Array.from({ length: 16 }, (_, i) => Math.cos((hue + i * 7) * 0.3))),
      embedVersion: "uniform-v1",
      sampleCount: opts.samples ?? 4,
      updatedAt: new Date(),
    },
  });
  createdTemplates.push(t.id);
  return t;
}

/** Ảnh áo rời dùng làm ảnh mẫu (có logo như áo đồng phục thật). */
async function shirtSwatch(color: { r: number; g: number; b: number }, logo = true) {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 256, height: 256, channels: 3, background: color } })
    .composite(logo ? [{ input: { create: { width: 70, height: 50, channels: 3 as const, background: { r: 235, g: 200, b: 60 } } }, left: 90, top: 100 }] : [])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Mẫu áo tính từ ảnh thật (giống hệt cách trang quản trị sẽ làm). */
async function templateFromImage(departmentId: number, name: string, color: { r: number; g: number; b: number }, logo = true) {
  const buf = await shirtSwatch(color, logo);
  const f = await withUniformModel((m) => extractSampleFeature(buf, m));
  const t = await prisma.uniformTemplate.create({
    data: {
      departmentId,
      name,
      colorHist: JSON.stringify({ hist: f!.colorHist, pattern: f!.pattern }),
      embedding: f!.embedding ? JSON.stringify(f!.embedding) : null,
      embedVersion: f!.embedding ? "uniform-v1" : null,
      colorHex: f!.colorHex,
      sampleCount: 4,
      updatedAt: new Date(),
    },
  });
  createdTemplates.push(t.id);
  return t;
}
const checkOf = (employeeId: number, workDate = todayVN()) => prisma.uniformCheck.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });

beforeAll(async () => {
  [emp, other] = await Promise.all([byCode("NV007"), byCode("NV009")]);
  const paired = await pairedDevice(`Kiosk ${tag}`);
  cookie = paired.cookie;
  deviceId = paired.device.id;
  // Mô hình giả: vector suy từ màu trung bình của ảnh → ảnh nào cũng cho vector ổn định.
  __setUniformEmbedTestHook(FAKE_MODEL);
});

/** Mô hình giả dùng lại nhiều nơi: vector one-hot theo màu chủ đạo. */
function FAKE_MODEL(rgb: Uint8Array) {
  {
    // Vector one-hot theo màu chủ đạo: hai áo khác màu cho cosine ~0, cùng màu cho ~1 — đủ gần mô hình thật cho test.
    let r = 0;
    let g = 0;
    let b = 0;
    const n = Math.floor(rgb.length / 3);
    for (let i = 0; i < n; i++) {
      r += rgb[i * 3];
      g += rgb[i * 3 + 1];
      b += rgb[i * 3 + 2];
    }
    const max = Math.max(r, g, b);
    const bucket = max === r ? 0 : max === g ? 1 : 2;
    const level = Math.min(3, Math.floor(max / n / 64));
    const v = new Float32Array(16);
    v[bucket * 4 + level] = 1;
    return v;
  }
}

afterEach(async () => {
  await prisma.uniformCheck.deleteMany({ where: { employeeId: { in: [emp.id, other.id] } } });
  await prisma.uniformTemplate.deleteMany({ where: { id: { in: createdTemplates.splice(0) } } });
  await prisma.department.updateMany({ where: { id: { in: [emp.departmentId, other.departmentId] } }, data: { uniformMode: "OFF" } });
  if (createdLogs.length) await prisma.attendanceLog.deleteMany({ where: { id: { in: createdLogs.splice(0) } } });
});

afterAll(async () => {
  __setUniformEmbedTestHook(null);
  await prisma.kioskDevice.deleteMany({ where: { id: deviceId } });
});

describe("chọn lượt chấm vào đầu ca", () => {
  const log = (o: Partial<Parameters<typeof pickFirstInLogs>[0][number]>) => ({
    id: 1,
    employeeId: 9,
    workDate: "2026-09-30",
    checkTime: new Date("2026-09-30T01:00:00Z"),
    shiftId: 5,
    snapshotUrl: "/api/snapshots/2026/09/30/x.jpg",
    faceBox: "[1,2,3,4]",
    source: "KIOSK",
    ...o,
  });

  it("lấy log sớm nhất có gắn ca của mỗi người mỗi ngày", () => {
    const r = pickFirstInLogs([
      log({ id: 2, checkTime: new Date("2026-09-30T03:00:00Z") }),
      log({ id: 1, checkTime: new Date("2026-09-30T01:00:00Z") }),
      log({ id: 3, checkTime: new Date("2026-09-30T10:00:00Z") }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].logId).toBe(1);
  });

  it("bỏ qua lượt ngoài ca, chấm tay, thiếu ảnh hoặc thiếu khung mặt", () => {
    expect(pickFirstInLogs([log({ shiftId: null })])).toHaveLength(0);
    expect(pickFirstInLogs([log({ source: "MANUAL" })])).toHaveLength(0);
    expect(pickFirstInLogs([log({ snapshotUrl: null })])).toHaveLength(0);
    expect(pickFirstInLogs([log({ faceBox: null })])).toHaveLength(0);
  });

  it("quét ngoài ca rồi quét trong ca → lấy lượt trong ca", () => {
    const r = pickFirstInLogs([
      log({ id: 1, shiftId: null, checkTime: new Date("2026-09-30T00:00:00Z") }),
      log({ id: 2, shiftId: 5, checkTime: new Date("2026-09-30T01:00:00Z") }),
    ]);
    expect(r.map((x) => x.logId)).toEqual([2]);
  });

  it("hai log trùng giờ → chọn log id nhỏ hơn (kết quả tất định)", () => {
    const t = new Date("2026-09-30T01:00:00Z");
    expect(pickFirstInLogs([log({ id: 7, checkTime: t }), log({ id: 3, checkTime: t })])[0].logId).toBe(3);
  });

  it("mỗi người mỗi ngày một bản ghi", () => {
    const r = pickFirstInLogs([log({ id: 1, employeeId: 1 }), log({ id: 2, employeeId: 2 }), log({ id: 3, employeeId: 1, workDate: "2026-10-01" })]);
    expect(r).toHaveLength(3);
  });
});

describe("job kiểm đồng phục", () => {
  it("phòng tắt kiểm → không tạo bản ghi nào", async () => {
    const base = await enrollFake(emp.id, 7001);
    await scan(emp, new Date(), base);
    await runJob("uniform-check");
    expect(await checkOf(emp.id)).toBeNull();
  });

  it("phòng bật kiểm nhưng chưa khai mẫu áo → BỎ QUA kèm lý do, NHƯNG vẫn lưu ảnh vùng áo", async () => {
    // Ảnh vùng áo chính là nguồn để Nhân sự bấm "Dùng ảnh này làm ảnh mẫu". Không lưu thì thành vòng luẩn quẩn:
    // muốn có mẫu áo phải có ảnh, muốn có ảnh phải có mẫu áo.
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    const base = await enrollFake(emp.id, 7002);
    await scan(emp, new Date(), base, { snapshot: await shirtSnapshot() });
    await runJob("uniform-check");
    const c = await checkOf(emp.id);
    expect(c?.status).toBe("SKIPPED");
    expect(c?.reason).toBe("NO_TEMPLATE");
    expect(c?.cropUrl).toBeTruthy();
    expect(c?.logId).toBeTruthy(); // đủ để addSampleFromCheck cắt lại từ ảnh gốc
  });

  it("có mẫu áo → tạo bản ghi, lưu đủ điểm và ảnh vùng áo", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    const base = await enrollFake(emp.id, 7003);
    const { log } = await scan(emp, new Date(), base, { snapshot: await shirtSnapshot() });
    const r = (await runJob("uniform-check")) as { created: number; scanned: number };
    expect(r.created).toBe(1);
    const c = await checkOf(emp.id);
    expect(c).not.toBeNull();
    expect(["PASS", "FAIL", "REVIEW"]).toContain(c!.status);
    expect(c!.machineStatus).toBe(c!.status); // chưa ai xác nhận nên hai cột bằng nhau
    expect(c!.logId).toBe(log!.id);
    expect(c!.departmentId).toBe(emp.departmentId);
    expect(c!.mode).toBe("ON");
    expect(c!.colorScore).not.toBeNull();
    expect(JSON.parse(c!.detail!).thresholds).toBeTruthy();
  });

  it("chạy job hai lần không tạo bản ghi trùng", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7004));
    await runJob("uniform-check");
    const r2 = (await runJob("uniform-check")) as { created: number };
    expect(r2.created).toBe(0);
    expect(await prisma.uniformCheck.count({ where: { employeeId: emp.id } })).toBe(1);
  });

  it("chế độ chạy thử: vẫn chấm điểm nhưng đánh dấu SHADOW", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "SHADOW" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7005));
    await runJob("uniform-check");
    const c = await checkOf(emp.id);
    expect(c?.mode).toBe("SHADOW");
    expect(c?.machineStatus).toBeTruthy();
  });

  it("người 'không chấm công' → bỏ qua hoàn toàn", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await prisma.employee.update({ where: { id: emp.id }, data: { attendanceExempt: true } });
    try {
      await scan(emp, new Date(), await enrollFake(emp.id, 7006));
      await runJob("uniform-check");
      expect(await checkOf(emp.id)).toBeNull();
    } finally {
      await prisma.employee.update({ where: { id: emp.id }, data: { attendanceExempt: null } });
    }
  });

  it("lượt quét thiếu khung mặt → không kiểm được, không tạo bản ghi", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7007), { faceBox: null });
    await runJob("uniform-check");
    expect(await checkOf(emp.id)).toBeNull();
  });

  it("mẫu áo còn ít ảnh → luôn CẦN XEM LẠI, không kết luận", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo mới`, { samples: 1 });
    await scan(emp, new Date(), await enrollFake(emp.id, 7008), { snapshot: await shirtSnapshot() });
    await runJob("uniform-check");
    const c = await checkOf(emp.id);
    expect(c?.status).toBe("REVIEW");
    expect(c?.reason).toBe("LOW_CONFIDENCE_TEMPLATE");
  });

  it("mẫu áo đang tắt thì không dùng để so", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo cũ`, { active: false });
    await scan(emp, new Date(), await enrollFake(emp.id, 7009), { snapshot: await shirtSnapshot() });
    await runJob("uniform-check");
    const c = await checkOf(emp.id);
    expect(c?.reason).toBe("NO_TEMPLATE");
    expect(c?.cropUrl).toBeTruthy(); // vẫn có ảnh để lấy làm mẫu cho mẫu áo đang chờ bật
  });

  it("chỉ kiểm phòng đã bật, phòng khác không bị đụng tới", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7010));
    await scan(other, new Date(), await enrollFake(other.id, 7011));
    await runJob("uniform-check");
    expect(await checkOf(emp.id)).not.toBeNull();
    expect(await checkOf(other.id)).toBeNull();
  });

  it("tháng đã chốt công → không kiểm (số liệu tháng đó đã khóa)", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7012));
    const month = todayVN().slice(0, 7);
    const lock = await prisma.payrollLock.create({ data: { month, lockedById: emp.id } });
    try {
      await runJob("uniform-check");
      expect(await checkOf(emp.id)).toBeNull();
    } finally {
      await prisma.payrollLock.delete({ where: { month: lock.month } });
    }
  });

  it("mô hình lỗi → vẫn chạy bằng màu, không ném lỗi ra job", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    await scan(emp, new Date(), await enrollFake(emp.id, 7013));
    __setUniformEmbedTestHook(() => {
      throw new Error("mô hình hỏng");
    });
    try {
      const r = (await runJob("uniform-check")) as { created: number };
      expect(r.created).toBe(1);
      const c = await checkOf(emp.id);
      expect(c).not.toBeNull();
      expect(c!.status).not.toBe("FAIL"); // hỏng mô hình không bao giờ thành "không đạt"
    } finally {
      __setUniformEmbedTestHook(FAKE_MODEL); // khôi phục mô hình giả cho các ca sau
    }
  });

  it("không có lượt chấm nào thì job chạy rất nhanh và không tạo gì", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    const r = (await runJob("uniform-check")) as { created: number; scanned: number };
    expect(r.created).toBe(0);
    expect(r.scanned).toBe(0);
  });
});

describe("kết luận đúng trên ảnh có áo thật", () => {
  const NAVY = { r: 30, g: 45, b: 95 };
  const DO = { r: 175, g: 40, b: 40 };

  async function chay(anh: { shirt?: { r: number; g: number; b: number }; logo?: boolean }, mau = NAVY, mauLogo = true) {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await templateFromImage(emp.departmentId, `${tag} Áo đồng phục`, mau, mauLogo);
    await scan(emp, new Date(), await enrollFake(emp.id, 7100 + Math.floor(Math.random() * 800)), { snapshot: await shirtSnapshot(anh) });
    await runJob("uniform-check");
    return checkOf(emp.id);
  }

  it("mặc đúng áo đồng phục → ĐẠT, ghi rõ mẫu áo khớp", async () => {
    const c = await chay({ shirt: NAVY, logo: true });
    expect(c?.status).toBe("PASS");
    expect(c?.templateId).not.toBeNull();
    expect(c?.colorScore).toBeGreaterThan(0.5);
  });

  it("mặc áo khác màu hẳn → KHÔNG ĐẠT", async () => {
    const c = await chay({ shirt: DO, logo: false });
    expect(c?.status).toBe("FAIL");
    expect(c?.reason).toBe("LOW_SCORE");
  });

  it("áo cùng màu nhưng không có logo → CẦN XEM LẠI chứ không kết luận", async () => {
    const c = await chay({ shirt: NAVY, logo: false });
    expect(c?.status).toBe("REVIEW");
    expect(c?.reason).toBe("LOGO_MISSING");
  });
});

describe("không làm chậm lượt chấm công", () => {
  it("bật kiểm đồng phục không làm lượt quét kiosk chậm đi", async () => {
    const base = await enrollFake(emp.id, 7020);
    const đo = async () => {
      const t0 = performance.now();
      await scan(emp, new Date(), base);
      return performance.now() - t0;
    };
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "OFF" } });
    const tat = await đo();
    await prisma.department.update({ where: { id: emp.departmentId }, data: { uniformMode: "ON" } });
    await makeTemplate(emp.departmentId, `${tag} Áo navy`);
    const bat = await đo();
    // Route chỉ ghi thêm 4 con số; mọi việc nặng nằm ở job nền.
    expect(bat).toBeLessThan(tat + 150);
  });

  it("khung mặt được ghi vào log để job dùng lại", async () => {
    const { log } = await scan(emp, new Date(), await enrollFake(emp.id, 7021));
    expect(log?.faceBox).toBeTruthy();
    expect(JSON.parse(log!.faceBox!)).toHaveLength(4);
  });

  it("vẫn quét được khi kiosk đời cũ không gửi khung mặt", async () => {
    const { result, log } = await scan(emp, new Date(), await enrollFake(emp.id, 7022), { faceBox: null });
    expect(result).toBe("OK");
    expect(log?.faceBox).toBeNull();
  });
});
