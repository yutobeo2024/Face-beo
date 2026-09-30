// v1.20.0: trang quản trị đồng phục — mẫu áo, chế độ kiểm theo phòng, xác nhận kết luận, quyền và phạm vi phòng.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { invalidatePermissionCache } from "@/lib/permissions";
import { __setUniformEmbedTestHook } from "@/lib/uniform-embed";
import { binaryReq, byCode, ctx, req, sessionCookie } from "./helpers";

import * as templatesRoute from "@/app/api/uniform/templates/route";
import * as templateRoute from "@/app/api/uniform/templates/[id]/route";
import * as samplesRoute from "@/app/api/uniform/templates/[id]/samples/route";
import * as fromCheckRoute from "@/app/api/uniform/templates/[id]/samples/from-check/route";
import * as sampleRoute from "@/app/api/uniform/templates/[id]/samples/[sid]/route";
import * as checksRoute from "@/app/api/uniform/checks/route";
import * as checkRoute from "@/app/api/uniform/checks/[id]/route";
import * as deptModeRoute from "@/app/api/uniform/departments/[id]/route";

const tag = `UA${Date.now().toString().slice(-5)}`;
type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, emp: E;
let A = "", H = "", M = "", EMP = "";
const createdTemplates: number[] = [];

/** Ảnh áo mẫu: màu nền + logo, đủ để tính đặc trưng thật. */
async function shirtImage(color = { r: 30, g: 45, b: 95 }, logo = true) {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 256, height: 256, channels: 3, background: color } })
    .composite(logo ? [{ input: { create: { width: 70, height: 50, channels: 3 as const, background: { r: 235, g: 200, b: 60 } } }, left: 90, top: 100 }] : [])
    .jpeg({ quality: 90 })
    .toBuffer();
}

const listTemplates = (cookie: string) => templatesRoute.GET(req("/api/uniform/templates", { cookie }), ctx());
const addTemplate = (cookie: string, departmentId: number, name: string) =>
  templatesRoute.POST(req("/api/uniform/templates", { method: "POST", cookie, body: { departmentId, name } }), ctx());
const patchTemplate = (cookie: string, id: number, body: unknown) =>
  templateRoute.PATCH(req(`/api/uniform/templates/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));
const delTemplate = (cookie: string, id: number) => templateRoute.DELETE(req(`/api/uniform/templates/${id}`, { method: "DELETE", cookie }), ctx({ id: String(id) }));
const setMode = (cookie: string, deptId: number, uniformMode: string) =>
  deptModeRoute.PATCH(req(`/api/uniform/departments/${deptId}`, { method: "PATCH", cookie, body: { uniformMode } }), ctx({ id: String(deptId) }));

async function putSample(cookie: string, id: number, kind = "SHIRT", img?: Buffer) {
  const body = img ?? (await shirtImage());
  return samplesRoute.PUT(binaryReq(`/api/uniform/templates/${id}/samples?kind=${kind}`, body, { cookie }), ctx({ id: String(id) }));
}

/** Mẫu áo dùng được PHẢI dựng từ ảnh người mặc — ảnh áo rời không tính (xem recomputeTemplate). */
async function newTemplate(cookie: string, deptId: number, name: string, samples = 3) {
  const res = await addTemplate(cookie, deptId, name);
  const { template } = await res.json();
  createdTemplates.push(template.id);
  for (let i = 0; i < samples; i++) await putSample(cookie, template.id, "WORN");
  return template.id as number;
}

beforeAll(async () => {
  [admin, hr, mgr, emp] = await Promise.all([byCode("NV001"), byCode("NV016"), byCode("NV003"), byCode("NV008")]);
  [A, H, M, EMP] = await Promise.all([admin.id, hr.id, mgr.id, emp.id].map(sessionCookie));
  __setUniformEmbedTestHook(() => Float32Array.from([1, 0, 0, 0]));
});

afterEach(async () => {
  if (createdTemplates.length) await prisma.uniformTemplate.deleteMany({ where: { id: { in: createdTemplates.splice(0) } } });
  await prisma.uniformCheck.deleteMany({ where: { employeeId: { in: [emp.id, mgr.id, hr.id, admin.id] } } });
  await prisma.department.updateMany({ data: { uniformMode: "OFF" } });
  invalidatePermissionCache();
});

afterAll(() => __setUniformEmbedTestHook(null));

describe("mẫu áo", () => {
  it("Nhân sự thêm được mẫu áo; mẫu mới chưa bật vì chưa có ảnh", async () => {
    const res = await addTemplate(H, emp.departmentId, `${tag} Navy`);
    expect(res.status).toBe(200);
    const { template } = await res.json();
    createdTemplates.push(template.id);
    const row = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(row.active).toBe(false);
    expect(row.sampleCount).toBe(0);
  });

  it("thêm ảnh mẫu → tính ngay màu và đặc trưng, đủ 3 ảnh thì hết cảnh báo", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Navy`, 1);
    let row = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id } });
    expect(row.sampleCount).toBe(1);
    expect(row.colorHist).toBeTruthy();
    expect(row.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(row.embedding).toBeTruthy();

    await putSample(H, id, "WORN");
    await putSample(H, id, "WORN");
    row = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id } });
    expect(row.sampleCount).toBe(3);
    const list = await (await listTemplates(H)).json();
    expect(list.templates.find((t: { id: number }) => t.id === id).warning).toBeNull();
  });

  it("chỉ có ảnh ÁO RỜI thì không kết luận được, dù tải bao nhiêu ảnh", async () => {
    // Đo trên ảnh thật: mẫu dựng từ áo trải phẳng chấm chính người mặc đúng áo đó chỉ 0,35–0,40 ⇒ báo oan hàng loạt.
    const id = await newTemplate(H, emp.departmentId, `${tag} AoRoi`, 0);
    for (let i = 0; i < 4; i++) await putSample(H, id, "SHIRT");
    const row = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id } });
    expect(row.colorHist).toBeTruthy(); // vẫn đo được màu để người nhìn đối chiếu
    expect(row.sampleCount).toBe(0); // nhưng KHÔNG tính là ảnh mẫu đáng tin
    const list = await (await listTemplates(H)).json();
    const t = list.templates.find((x: { id: number }) => x.id === id);
    expect(t.warning).toContain("áo rời");
    expect(t.warning).toContain("NGƯỜI MẶC");

    // Thêm ảnh người mặc vào thì đếm lại từ đó.
    await putSample(H, id, "WORN");
    expect((await prisma.uniformTemplate.findUniqueOrThrow({ where: { id } })).sampleCount).toBe(1);
  });

  it("mẫu áo dưới 3 ảnh thì báo rõ là chưa đủ tin", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Ít ảnh`, 1);
    const list = await (await listTemplates(H)).json();
    expect(list.templates.find((t: { id: number }) => t.id === id).warning).toContain("cần xem lại");
  });

  it("xóa hết ảnh mẫu → mẫu áo tự tắt và không còn đặc trưng", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Xóa ảnh`, 1);
    const s = await prisma.uniformSample.findFirstOrThrow({ where: { templateId: id } });
    const res = await sampleRoute.DELETE(req(`/api/uniform/templates/${id}/samples/${s.id}`, { method: "DELETE", cookie: H }), ctx({ id: String(id), sid: String(s.id) }));
    expect(res.status).toBe(200);
    const row = await prisma.uniformTemplate.findUniqueOrThrow({ where: { id } });
    expect(row.sampleCount).toBe(0);
    expect(row.active).toBe(false);
    expect(row.colorHist).toBeNull();
  });

  it("trùng tên trong cùng phòng → 400, phòng khác thì được", async () => {
    await newTemplate(H, emp.departmentId, `${tag} Trùng`, 1);
    expect((await addTemplate(H, emp.departmentId, `${tag} Trùng`)).status).toBe(400);
    const ok = await addTemplate(H, admin.departmentId, `${tag} Trùng`); // phòng khác hẳn (emp và mgr cùng phòng)
    expect(ok.status).toBe(200);
    createdTemplates.push((await ok.json()).template.id);
  });

  it("ảnh không hợp lệ hoặc quá lớn → 400", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Ảnh lỗi`, 0);
    const rác = await putSample(H, id, "SHIRT", Buffer.from("day khong phai anh"));
    expect(rác.status).toBe(400);
    const to = await putSample(H, id, "SHIRT", Buffer.alloc(2 * 1024 * 1024 + 10, 1));
    expect(to.status).toBe(400);
  });

  it("chưa có ảnh thì không bật được mẫu áo", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Chưa ảnh`, 0);
    const res = await patchTemplate(H, id, { active: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ảnh mẫu");
  });

  it("mẫu áo đã dùng để kết luận thì không xóa được, chỉ tắt", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Đã dùng`, 1);
    await prisma.uniformCheck.create({
      data: { employeeId: emp.id, workDate: todayVN(), departmentId: emp.departmentId, checkTime: new Date(), machineStatus: "PASS", status: "PASS", templateId: id },
    });
    const res = await delTemplate(H, id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("chỉ có thể tắt");
    expect((await patchTemplate(H, id, { active: false })).status).toBe(200);
  });

  it("Nhân viên thường không xem, không sửa được", async () => {
    expect((await listTemplates(EMP)).status).toBe(403);
    expect((await addTemplate(EMP, emp.departmentId, `${tag} Trộm`)).status).toBe(403);
  });

  it("Quản lý xem được nhưng không thêm được mẫu áo", async () => {
    expect((await listTemplates(M)).status).toBe(200);
    expect((await addTemplate(M, mgr.departmentId, `${tag} QL`)).status).toBe(403);
  });

  it("Quản lý chỉ thấy mẫu áo của phòng mình", async () => {
    await newTemplate(H, admin.departmentId, `${tag} Phòng khác`, 1);
    const mine = await newTemplate(H, mgr.departmentId, `${tag} Phòng tôi`, 1);
    const list = await (await listTemplates(M)).json();
    const ids = list.templates.map((t: { id: number }) => t.id);
    expect(ids).toContain(mine);
    expect(list.templates.every((t: { departmentId: number }) => t.departmentId === mgr.departmentId)).toBe(true);
  });
});

describe("chế độ kiểm của phòng", () => {
  it("chưa có mẫu áo đang bật → không cho bật kiểm", async () => {
    const res = await setMode(H, emp.departmentId, "ON");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mẫu áo");
  });

  it("có mẫu áo rồi thì bật được, có ghi nhật ký", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} Navy`, 3);
    await patchTemplate(H, id, { active: true });
    expect((await setMode(H, emp.departmentId, "SHADOW")).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: emp.departmentId } })).uniformMode).toBe("SHADOW");
    const log = await prisma.auditLog.findFirst({ where: { action: "UNIFORM_MODE" }, orderBy: { id: "desc" } });
    expect(JSON.parse(log!.detail!).to).toBe("SHADOW");
  });

  it("giá trị lạ → 400; Nhân viên → 403", async () => {
    expect((await setMode(H, emp.departmentId, "BAT_HET")).status).toBe(400);
    expect((await setMode(EMP, emp.departmentId, "ON")).status).toBe(403);
  });

  it("Quản lý không có quyền quản lý đồng phục → 403", async () => {
    expect((await setMode(M, mgr.departmentId, "ON")).status).toBe(403);
  });

  it("Quản trị bật/tắt được kiểm ở phòng bất kỳ", async () => {
    const id = await newTemplate(A, mgr.departmentId, `${tag} Admin`, 3);
    await patchTemplate(A, id, { active: true });
    expect((await setMode(A, mgr.departmentId, "SHADOW")).status).toBe(200);
    expect((await setMode(A, mgr.departmentId, "OFF")).status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: mgr.departmentId } })).uniformMode).toBe("OFF");
  });
});

describe("bảng theo dõi và xác nhận", () => {
  async function seedCheck(employeeId: number, departmentId: number, status = "REVIEW") {
    return prisma.uniformCheck.create({
      data: { employeeId, workDate: todayVN(), departmentId, checkTime: new Date(), machineStatus: status, status, reason: "AMBIGUOUS", score: 0.5, colorScore: 0.5 },
    });
  }
  const listChecks = (cookie: string, extra = "") =>
    checksRoute.GET(req(`/api/uniform/checks?from=${todayVN()}&to=${todayVN()}${extra}`, { cookie }), ctx());
  const decide = (cookie: string, id: number, body: unknown) =>
    checkRoute.PATCH(req(`/api/uniform/checks/${id}`, { method: "PATCH", cookie, body }), ctx({ id: String(id) }));

  it("Nhân sự thấy bản ghi kèm lý do bằng tiếng Việt", async () => {
    await seedCheck(emp.id, emp.departmentId);
    const body = await (await listChecks(H)).json();
    const row = body.rows.find((r: { employee: { id: number } | null }) => r.employee?.id === emp.id);
    expect(row.status).toBe("REVIEW");
    expect(row.reasonText).toContain("chưa chắc");
  });

  it("xác nhận Đạt: đổi kết luận nhưng GIỮ nguyên kết luận của máy", async () => {
    const c = await seedCheck(emp.id, emp.departmentId);
    const res = await decide(H, c.id, { status: "PASS" });
    expect(res.status).toBe(200);
    const after = await prisma.uniformCheck.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("PASS");
    expect(after.machineStatus).toBe("REVIEW");
    expect(after.decidedById).toBe(hr.id);
    expect(after.decidedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { action: "UNIFORM_DECIDE" }, orderBy: { id: "desc" } });
    expect(JSON.parse(log!.detail!).to).toBe("PASS");
  });

  it("người chỉ được chọn Đạt / Không đạt, không được đặt 'cần xem lại'", async () => {
    const c = await seedCheck(emp.id, emp.departmentId);
    expect((await decide(H, c.id, { status: "REVIEW" })).status).toBe(400);
    expect((await decide(H, c.id, { status: "SKIPPED" })).status).toBe(400);
  });

  it("Quản lý chỉ thấy và chỉ sửa được phòng mình", async () => {
    const mine = await seedCheck(emp.id, emp.departmentId); // emp cùng phòng với quản lý
    const other = await seedCheck(hr.id, hr.departmentId); // phòng khác
    const body = await (await listChecks(M)).json();
    expect(body.rows.some((r: { id: number }) => r.id === mine.id)).toBe(true);
    expect(body.rows.some((r: { id: number }) => r.id === other.id)).toBe(false);
    expect((await decide(M, other.id, { status: "PASS" })).status).toBe(403);
    expect((await decide(M, mine.id, { status: "PASS" })).status).toBe(403); // Quản lý không có quyền xác nhận
  });

  it("Nhân viên thường không xem được bảng theo dõi", async () => {
    expect((await listChecks(EMP)).status).toBe(403);
  });

  it("khoảng ngày quá 31 ngày → 400", async () => {
    const res = await checksRoute.GET(req(`/api/uniform/checks?from=2026-01-01&to=2026-03-01`, { cookie: H }), ctx());
    expect(res.status).toBe(400);
  });

  it("lọc theo trạng thái và theo chế độ chạy thử", async () => {
    await seedCheck(emp.id, emp.departmentId, "FAIL");
    expect((await (await listChecks(H, "&status=FAIL")).json()).rows.length).toBeGreaterThan(0);
    expect((await (await listChecks(H, "&status=PASS")).json()).rows.length).toBe(0);
    expect((await (await listChecks(H, "&mode=SHADOW")).json()).rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lấy ảnh mẫu thẳng từ một lượt chấm công: cách lấy mẫu đúng điều kiện nhất.
// ---------------------------------------------------------------------------
describe("lấy ảnh mẫu từ lượt chấm công", () => {
  const createdLogs: number[] = [];

  /** Ảnh chấm công giả: tường, khuôn mặt, thân áo có logo — giống khung 1280×720 của kiosk. */
  async function kioskSnapshot(shirt = { r: 30, g: 45, b: 95 }) {
    const sharp = (await import("sharp")).default;
    const W = 1280;
    const H = 720;
    const px = new Uint8Array(W * H * 3);
    const noise = (i: number) => ((i * 2654435761) % 29) - 14;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        let c = { r: 180, g: 178, b: 176 };
        if (x >= 520 && x < 670 && y >= 330 && y < 520) c = { r: 205, g: 160, b: 135 };
        else if (x >= 410 && x < 830 && y >= 520) c = shirt;
        if (x >= 560 && x < 630 && y >= 600 && y < 650) c = { r: 235, g: 200, b: 60 };
        const d = noise(i) + (y >= 520 ? Math.round(((y - 520) / 200) * 18) : 0);
        px[i] = Math.max(0, Math.min(255, c.r + d));
        px[i + 1] = Math.max(0, Math.min(255, c.g + d));
        px[i + 2] = Math.max(0, Math.min(255, c.b + d));
      }
    }
    return sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  }

  /** Dựng một lượt chấm công có ảnh thật + khung mặt, kèm bản ghi kiểm trỏ về nó. */
  async function seedCheckWithLog(o: { employeeId: number; departmentId: number; faceBox?: string | null; snapshot?: boolean } = { employeeId: 0, departmentId: 0 }) {
    const { saveSnapshot } = await import("@/lib/storage");
    const url = o.snapshot === false ? null : await saveSnapshot(await kioskSnapshot());
    const log = await prisma.attendanceLog.create({
      data: { employeeId: o.employeeId, workDate: todayVN(), checkTime: new Date(), type: "IN", source: "KIOSK", snapshotUrl: url, faceBox: o.faceBox === undefined ? "[520,330,150,190]" : o.faceBox },
    });
    createdLogs.push(log.id);
    const check = await prisma.uniformCheck.create({
      data: { employeeId: o.employeeId, departmentId: o.departmentId, workDate: todayVN(), logId: log.id, checkTime: new Date(), machineStatus: "REVIEW", status: "REVIEW", reason: "AMBIGUOUS" },
    });
    return { log, check };
  }

  const fromCheck = (cookie: string, templateId: number, checkId: number) =>
    fromCheckRoute.POST(req(`/api/uniform/templates/${templateId}/samples/from-check`, { method: "POST", cookie, body: { checkId } }), ctx({ id: String(templateId) }));

  afterEach(async () => {
    if (createdLogs.length) await prisma.attendanceLog.deleteMany({ where: { id: { in: createdLogs.splice(0) } } });
  });

  it("thêm được ảnh mẫu và tính lại đặc trưng ngay", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} TuCham`, 0);
    const { check } = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId });
    const res = await fromCheck(H, id, check.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sampleCount).toBe(1);
    expect(body.ready).toBe(true);
    expect(body.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
    // Ảnh lấy từ lượt chấm công luôn ghi là "người mặc".
    expect(body.sample.kind).toBe("WORN");
  });

  it("ảnh mẫu lấy ra KHÔNG chứa khuôn mặt (cắt dưới cằm)", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} KhongMat`, 0);
    const { check } = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId });
    await fromCheck(H, id, check.id);
    const sample = await prisma.uniformSample.findFirstOrThrow({ where: { templateId: id } });
    const { readTemplateSample } = await import("@/lib/uniform-storage");
    const buf = await readTemplateSample(sample.fileKey);
    const sharp = (await import("sharp")).default;
    const raw = await sharp(buf!).removeAlpha().raw().toBuffer();
    const { meanColorHex, skinRatio } = await import("@/lib/uniform-color");
    // Vùng cắt nằm hẳn dưới khung mặt [520,330,150,190]: gần như không có màu da,
    // và màu chủ đạo phải là màu ÁO (xanh navy) chứ không phải màu mặt (hồng).
    expect(skinRatio(raw)).toBeLessThan(0.05);
    const hex = meanColorHex(raw, [1, 1, 1]);
    const [r, b] = [1, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(r).toBeLessThan(120); // màu mặt trong ảnh giả là r = 205
  });

  it("bản ghi của phòng khác → 400", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} KhacPhong`, 0);
    const { check } = await seedCheckWithLog({ employeeId: admin.id, departmentId: admin.departmentId });
    const res = await fromCheck(H, id, check.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("phòng khác");
  });

  it("lượt chấm công mất ảnh hoặc thiếu khung mặt → 400 kèm lý do", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} ThieuAnh`, 0);
    const a = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId, snapshot: false });
    expect((await fromCheck(H, id, a.check.id)).status).toBe(400);
    await prisma.uniformCheck.deleteMany({ where: { id: a.check.id } });
    const b = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId, faceBox: null });
    const res = await fromCheck(H, id, b.check.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ảnh|khung khuôn mặt/i);
  });

  it("Quản lý không có quyền quản lý mẫu áo → 403", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} QuyenQL`, 0);
    const { check } = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId });
    expect((await fromCheck(M, id, check.id)).status).toBe(403);
  });

  it("đủ 3 ảnh lấy từ lượt chấm công thì hết cảnh báo 'chưa đủ tin'", async () => {
    const id = await newTemplate(H, emp.departmentId, `${tag} DuBa`, 0);
    for (let i = 0; i < 3; i++) {
      const { check } = await seedCheckWithLog({ employeeId: emp.id, departmentId: emp.departmentId });
      expect((await fromCheck(H, id, check.id)).status).toBe(200);
      await prisma.uniformCheck.deleteMany({ where: { id: check.id } });
    }
    const body = await (await listTemplates(H)).json();
    const t = body.templates.find((x: { id: number }) => x.id === id);
    expect(t.sampleCount).toBe(3);
    expect(t.warning).toBeNull();
  });
});
