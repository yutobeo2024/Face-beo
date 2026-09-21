// QC v1.9.0 — hồ sơ hành nghề: các trường hợp biên / tấn công (bổ sung cho credentials.test.ts).
// QC v1.9.0: các test từng mang tiền tố "[BUG]" đã được sửa trong cùng đợt (tên file cắt giữa emoji, khóa digest, ngày tương lai, hạn trước ngày cấp, số tiết kiểu boolean).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { credentialCheck } from "@/lib/jobs";
import { cmeStatus } from "@/lib/credentials";
import { createEmployee } from "@/lib/employees";
import { invalidatePermissionCache } from "@/lib/permissions";
import { BASE, byCode, ctx, req, sessionCookie } from "./helpers";

import * as licenseRoute from "@/app/api/employees/[id]/license/route";
import * as verifyRoute from "@/app/api/employees/[id]/license/verify/route";
import * as credsRoute from "@/app/api/employees/[id]/credentials/route";
import * as credRoute from "@/app/api/employees/[id]/credentials/[cid]/route";
import * as fileRoute from "@/app/api/employees/[id]/credentials/[cid]/file/route";
import * as alertsRoute from "@/app/api/credentials/alerts/route";
import * as specialtyRoute from "@/app/api/specialties/[id]/route";
import * as employeeRoute from "@/app/api/employees/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, target: E, other: E;
let A: string, H: string, M: string;
let createdPerm = false;
let tempEmpId = 0;
let specialtyId = 0;

const LICENSE = { number: "QC-0001/BYT-CCHN", issuedAt: "2015-01-10", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám chữa bệnh Nội", status: "ACTIVE" };
const PDF = new TextEncoder().encode("%PDF-1.4\n% qc\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

const P = (e: { id: number }) => ({ id: String(e.id) });
const PC = (e: { id: number }, cid: number | string) => ({ id: String(e.id), cid: String(cid) });
const putLicense = (cookie: string, e: { id: number }, body: unknown) => licenseRoute.PUT(req(`/api/employees/${e.id}/license`, { method: "PUT", cookie, body }), ctx(P(e)));
const delLicense = (cookie: string, e: { id: number }) => licenseRoute.DELETE(req(`/api/employees/${e.id}/license`, { method: "DELETE", cookie }), ctx(P(e)));
const verify = (cookie: string, e: { id: number }) => verifyRoute.POST(req(`/api/employees/${e.id}/license/verify`, { method: "POST", cookie }), ctx(P(e)));
const addCred = (cookie: string, e: { id: number }, body: unknown) => credsRoute.POST(req(`/api/employees/${e.id}/credentials`, { method: "POST", cookie, body }), ctx(P(e)));
const patchCred = (cookie: string, e: { id: number }, cid: number | string, body: unknown) =>
  credRoute.PATCH(req(`/api/employees/${e.id}/credentials/${cid}`, { method: "PATCH", cookie, body }), ctx(PC(e, cid)));
const delCred = (cookie: string, e: { id: number }, cid: number | string) =>
  credRoute.DELETE(req(`/api/employees/${e.id}/credentials/${cid}`, { method: "DELETE", cookie }), ctx(PC(e, cid)));
const getFile = (cookie: string, e: { id: number }, cid: number | string) =>
  fileRoute.GET(req(`/api/employees/${e.id}/credentials/${cid}/file`, { cookie }), ctx(PC(e, cid)));
const upload = (cookie: string, e: { id: number }, cid: number | string, body: Uint8Array, rawHeaderName: string | null = "bang.pdf") => {
  const headers: Record<string, string> = { cookie, "content-type": "application/octet-stream" };
  if (rawHeaderName !== null) headers["x-file-name"] = rawHeaderName;
  return fileRoute.POST(
    new NextRequest(new URL(`/api/employees/${e.id}/credentials/${cid}/file`, BASE), { method: "POST", headers, body: new Uint8Array(body) }),
    ctx(PC(e, cid)),
  );
};
const newCred = async (cookie: string, e: { id: number }, body: Record<string, unknown> = {}) => {
  const r = await addCred(cookie, e, { type: "DEGREE", name: "Bằng QC", ...body });
  expect(r.status).toBe(201);
  return (await r.json()).item.id as number;
};
const credDir = (id: number) => join(dataDir(), "credentials", String(id));
const filesIn = (id: number) => (existsSync(credDir(id)) ? readdirSync(credDir(id)).length : 0);
const groupLogs = (part: string) => prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT", dedupeKey: { contains: part } } });

beforeAll(async () => {
  [admin, hr, mgr, target, other] = await Promise.all(["NV001", "NV016", "NV003", "NV008", "NV009"].map(byCode));
  [A, H, M] = await Promise.all([admin, hr, mgr].map((e) => sessionCookie(e.id)));
});

afterAll(async () => {
  const ids = [admin.id, hr.id, target.id, other.id];
  await prisma.credential.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.practiceLicense.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.update({ where: { id: other.id }, data: { active: true } });
  await prisma.appSetting.deleteMany({ where: { key: "credentialAlertSent" } });
  if (createdPerm) {
    await prisma.rolePermission.deleteMany({ where: { role: "MANAGER", capability: "employees.manage" } });
    invalidatePermissionCache();
  }
  if (tempEmpId && (await prisma.employee.findUnique({ where: { id: tempEmpId } }))) {
    await prisma.scheduleAssignment.deleteMany({ where: { employeeId: tempEmpId } });
    await prisma.employee.delete({ where: { id: tempEmpId } });
  }
  if (specialtyId) await prisma.specialty.deleteMany({ where: { id: specialtyId } });
});

describe("Quyền / chống leo thang", () => {
  it("HR sửa GPHN của ADMIN → 403; HR vẫn xem được (đọc = vai trò)", async () => {
    expect((await putLicense(H, admin, LICENSE)).status).toBe(403);
    expect((await addCred(H, admin, { type: "DEGREE", name: "Bằng" })).status).toBe(403);
    const g = await licenseRoute.GET(req(`/api/employees/${admin.id}/license`, { cookie: H }), ctx(P(admin)));
    expect(g.status).toBe(200);
    expect((await g.json()).canEdit).toBe(false);
  });

  it("ADMIN sửa GPHN của HR → 200; HR không đẩy được file vào chứng chỉ của ADMIN", async () => {
    expect((await putLicense(A, hr, LICENSE)).status).toBe(200);
    const cid = await newCred(A, admin);
    expect((await upload(H, admin, cid, PDF)).status).toBe(403);
    expect((await patchCred(H, admin, cid, { name: "Đổi" })).status).toBe(403);
    expect((await delCred(H, admin, cid)).status).toBe(403);
  });

  it("Quản lý được cấp employees.manage vẫn 403 (hồ sơ hành nghề theo vai trò HR/ADMIN)", async () => {
    const exists = await prisma.rolePermission.findUnique({ where: { role_capability: { role: "MANAGER", capability: "employees.manage" } } });
    if (!exists) {
      await prisma.rolePermission.create({ data: { role: "MANAGER", capability: "employees.manage" } });
      createdPerm = true;
    }
    invalidatePermissionCache();
    expect((await putLicense(M, target, LICENSE)).status).toBe(403);
    expect((await addCred(M, target, { type: "DEGREE", name: "Bằng" })).status).toBe(403);
    expect((await verify(M, target)).status).toBe(403);
    expect((await alertsRoute.GET(req("/api/credentials/alerts", { cookie: M }), ctx())).status).toBe(403);
  });

  it("không tự cập nhật / tự đối chiếu hồ sơ của chính mình (trừ ADMIN)", async () => {
    expect((await verify(H, hr)).status).toBe(403);
    expect((await putLicense(H, hr, LICENSE)).status).toBe(403);
    expect((await addCred(H, hr, { type: "DEGREE", name: "Bằng" })).status).toBe(403);
    expect((await putLicense(A, admin, LICENSE)).status).toBe(200);
    expect((await verify(A, admin)).status).toBe(200);
  });
});

describe("IDOR / tham số id", () => {
  it("chứng chỉ của người khác qua đường dẫn nhân viên này → 404 cho PATCH / DELETE / upload / GET file", async () => {
    const cid = await newCred(H, other);
    expect((await patchCred(H, target, cid, { name: "Chiếm" })).status).toBe(404);
    expect((await delCred(H, target, cid)).status).toBe(404);
    expect((await upload(H, target, cid, PDF)).status).toBe(404);
    expect((await getFile(H, target, cid)).status).toBe(404);
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    expect(row.name).toBe("Bằng QC");
    expect(row.fileKey).toBeNull();
  });

  it("cid không hợp lệ → 400; id nhân viên không tồn tại → 404", async () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) expect((await patchCred(H, target, bad, { name: "xx" })).status).toBe(400);
    expect((await putLicense(H, { id: 99999999 }, LICENSE)).status).toBe(404);
  });

  it("cid vượt Int32 (99999999999) → 400/404, không phải 500", async () => {
    const r = await patchCred(H, target, "99999999999", { name: "xx" });
    expect([400, 404]).toContain(r.status);
  });

  it("PATCH / POST không gán được trường ngoài schema (fileKey, employeeId)", async () => {
    const cid = await newCred(H, target);
    const r = await patchCred(H, target, cid, { fileKey: "../../../x.pdf", employeeId: other.id, fileName: "hack" });
    expect(r.status).toBe(200);
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    expect(row.employeeId).toBe(target.id);
    expect(row.fileKey).toBeNull();
    const r2 = await addCred(H, target, { type: "DEGREE", name: "Bằng 2", fileKey: "../x.pdf", employeeId: other.id });
    const item = (await r2.json()).item;
    expect(item.employeeId).toBe(target.id);
    expect(item.fileKey).toBeNull();
  });
});

describe("Kiểm dữ liệu", () => {
  it("PATCH đổi sang CME mà không có số tiết / ngày cấp → 400; xóa ngày cấp của CME → 400", async () => {
    const cid = await newCred(H, target);
    expect((await patchCred(H, target, cid, { type: "CME" })).status).toBe(400);
    expect((await patchCred(H, target, cid, { type: "CME", cmeHours: 8 })).status).toBe(400); // thiếu ngày cấp
    expect((await patchCred(H, target, cid, { type: "CME", cmeHours: 8, issuedAt: "2026-01-02" })).status).toBe(200);
    expect((await patchCred(H, target, cid, { issuedAt: "" })).status).toBe(400);
    expect((await patchCred(H, target, cid, { cmeHours: null })).status).toBe(400);
    expect((await patchCred(H, target, cid, { cmeHours: "" })).status).toBe(400);
  });

  it("PATCH name null / rỗng / 1 ký tự → 400; body {} → 200 không đổi", async () => {
    const cid = await newCred(H, target);
    expect((await patchCred(H, target, cid, { name: null })).status).toBe(400);
    expect((await patchCred(H, target, cid, { name: "" })).status).toBe(400);
    expect((await patchCred(H, target, cid, { name: " a " })).status).toBe(400);
    expect((await patchCred(H, target, cid, {})).status).toBe(200);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: cid } })).name).toBe("Bằng QC");
  });

  it("ngày không tồn tại → 400 (GPHN và chứng chỉ)", async () => {
    expect((await putLicense(H, target, { ...LICENSE, issuedAt: "2026-02-30" })).status).toBe(400);
    expect((await putLicense(H, target, { ...LICENSE, expiresAt: "2026-13-01" })).status).toBe(400);
    expect((await addCred(H, target, { type: "DEGREE", name: "Bằng", issuedAt: "2025-02-29" })).status).toBe(400);
    expect((await addCred(H, target, { type: "DEGREE", name: "Bằng", issuedAt: "2026-1-5" })).status).toBe(400);
    expect((await putLicense(H, target, { ...LICENSE, status: "EXPIRED" })).status).toBe(400);
  });

  it("ngày cấp CME trong tương lai → 400 (hiện nhận và âm thầm không tính tiết)", async () => {
    const r = await addCred(H, target, { type: "CME", name: "CME tương lai", cmeHours: 24, issuedAt: "2030-01-01" });
    if (r.status === 201) await delCred(H, target, (await r.json()).item.id);
    expect(r.status).toBe(400);
  });

  it("ngày hết hạn trước ngày cấp → 400 (chứng chỉ và GPHN)", async () => {
    const r = await addCred(H, target, { type: "SPECIALTY", name: "CC", issuedAt: "2025-05-01", expiresAt: "2024-05-01" });
    if (r.status === 201) await delCred(H, target, (await r.json()).item.id);
    expect(r.status).toBe(400);
    expect((await putLicense(H, target, { ...LICENSE, issuedAt: "2020-01-01", expiresAt: "2019-01-01" })).status).toBe(400);
  });

  it("cmeHours âm / 0 / quá lớn / chữ → 400; chuỗi số được ép kiểu", async () => {
    const base = { type: "CME", name: "CME", issuedAt: "2026-01-01" };
    for (const h of [-1, 0, 1001, 1e9, "abc", [], {}]) expect((await addCred(H, target, { ...base, cmeHours: h })).status, String(h)).toBe(400);
    const r = await addCred(H, target, { ...base, cmeHours: "12.5" });
    expect(r.status).toBe(201);
    expect((await r.json()).item.cmeHours).toBe(12.5);
  });

  it("cmeHours: true không được ép thành 1 tiết", async () => {
    const r = await addCred(H, target, { type: "CME", name: "CME bool", issuedAt: "2026-01-01", cmeHours: true });
    if (r.status === 201) await delCred(H, target, (await r.json()).item.id);
    expect(r.status).toBe(400);
  });

  it("xóa GPHN rồi đối chiếu → 400; xóa lần 2 vẫn 200 (idempotent)", async () => {
    expect((await putLicense(H, target, LICENSE)).status).toBe(200);
    expect((await delLicense(H, target)).status).toBe(200);
    expect((await verify(H, target)).status).toBe(400);
    expect((await delLicense(H, target)).status).toBe(200);
  });
});

describe("Tải file", () => {
  let cid = 0;
  beforeAll(async () => {
    cid = await newCred(H, target, { name: "Bằng file" });
  });

  it("GET file khi chưa có file → 404", async () => {
    expect((await getFile(H, target, cid)).status).toBe(404);
  });

  it("PNG và JPEG được nhận với MIME đúng; thân rỗng → 400", async () => {
    expect((await upload(H, target, cid, PNG, "a.png")).status).toBe(200);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: cid } })).fileMime).toBe("image/png");
    expect((await upload(H, target, cid, JPG, "a.jpg")).status).toBe(200);
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    expect(row.fileMime).toBe("image/jpeg");
    expect(row.fileKey).toMatch(/\.jpg$/);
    expect((await upload(H, target, cid, new Uint8Array(0))).status).toBe(400);
    // Đuôi .pdf nhưng nội dung PNG → lưu là PNG.
    expect((await upload(H, target, cid, PNG, "gia.pdf")).status).toBe(200);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: cid } })).fileMime).toBe("image/png");
  });

  it("tên file có ../, \\, NUL, CRLF (mã hóa) bị làm sạch; thiếu header → tên mặc định", async () => {
    expect((await upload(H, target, cid, PDF, encodeURIComponent("../../etc\\passwd\u0000\r\nX-Evil: 1.pdf"))).status).toBe(200);
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    expect(row.fileName).not.toMatch(/[\\/\r\n\u0000]/);
    const g = await getFile(H, target, cid);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
    expect((await upload(H, target, cid, PDF, null)).status).toBe(200);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: cid } })).fileName).toBe("tep.pdf");
  });

  it("tên file rất dài bị cắt 120 ký tự", async () => {
    expect((await upload(H, target, cid, PDF, encodeURIComponent("x".repeat(5000) + ".pdf"))).status).toBe(200);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: cid } })).fileName!.length).toBeLessThanOrEqual(120);
  });

  it("x-file-name mã hóa % sai → không 500 và không để file mồ côi trên đĩa", async () => {
    const before = filesIn(target.id);
    const r = await upload(H, target, cid, PDF, "%E0%A4%A");
    expect(r.status).not.toBe(500);
    expect(filesIn(target.id)).toBe(before);
  });

  it("tên file bị cắt giữa cặp surrogate (emoji ở ký tự 120) → upload và GET không 500", async () => {
    const up = await upload(H, target, cid, PDF, encodeURIComponent("a".repeat(119) + "😀.pdf"));
    expect(up.status).toBe(200);
    const g = await getFile(H, target, cid);
    expect(g.status).toBe(200);
  });

  it("file trên đĩa bị mất → GET 404 (không 500)", async () => {
    // Đặt lại file hợp lệ trước.
    expect((await upload(H, target, cid, PDF, "ok.pdf")).status).toBe(200);
    await prisma.credential.update({ where: { id: cid }, data: { fileKey: "00000000-0000-0000-0000-000000000000.pdf" } });
    expect((await getFile(H, target, cid)).status).toBe(404);
    await prisma.credential.update({ where: { id: cid }, data: { fileKey: "../../../package.json" } });
    expect((await getFile(H, target, cid)).status).toBe(404);
  });
});

describe("CME — biên chu kỳ (hàm thuần)", () => {
  const S = { cmeTwoYearHours: 48, cmeCycleHours: 120, cmeCycleYears: 5, credentialWarnDays: 90 };
  it("đúng ngày kỷ niệm: chu kỳ mới bắt đầu hôm nay, CME ngày hôm trước thuộc chu kỳ cũ", () => {
    const cmes = [
      { issuedAt: "2026-09-20", cmeHours: 10 },
      { issuedAt: "2026-09-21", cmeHours: 5 },
    ];
    const onDay = cmeStatus("2021-09-21", cmes, S, "2026-09-21");
    expect(onDay.cycle).toMatchObject({ from: "2026-09-21", to: "2031-09-21", hours: 5 });
    const dayBefore = cmeStatus("2021-09-21", cmes, S, "2026-09-20");
    expect(dayBefore.cycle).toMatchObject({ from: "2021-09-21", to: "2026-09-21", hours: 10, daysLeft: 1 });
  });
  it("cửa sổ 2 năm: đúng ngày cách 2 năm bị loại, ngày sau được tính", () => {
    const r = cmeStatus(null, [{ issuedAt: "2024-09-21", cmeHours: 7 }, { issuedAt: "2024-09-22", cmeHours: 3 }], S, "2026-09-21");
    expect(r.twoYearHours).toBe(3);
    expect(r.cycle).toBeNull();
  });
  it("mốc chu kỳ 29/02 không trôi ngày qua nhiều chu kỳ", () => {
    const r = cmeStatus("2024-02-29", [], S, "2034-03-15");
    // Chu kỳ thứ 3 phải bắt đầu 2034-02-28 hoặc 2034-03-01, không lệch thêm.
    expect(["2034-02-28", "2034-03-01"]).toContain(r.cycle!.from);
  });
});

describe("Cảnh báo & job", () => {
  const sentMap = async () => JSON.parse((await prisma.appSetting.findUnique({ where: { key: "credentialAlertSent" } }))?.value || "{}") as Record<string, string>;

  it("credential-check: sang tháng mới báo lại; cùng tháng không lặp", async () => {
    expect((await putLicense(H, target, { ...LICENSE, status: "SUSPENDED" })).status).toBe(200);
    const r1 = await credentialCheck(new Date("2026-09-21T01:00:00Z"));
    expect(r1.newIssues).toBeGreaterThanOrEqual(1);
    expect((await sentMap())[`${target.id}:license-status-SUSPENDED`]).toBe("2026-09");
    const r2 = await credentialCheck(new Date("2026-09-25T01:00:00Z"));
    expect(r2.newIssues).toBe(0);
    const r3 = await credentialCheck(new Date("2026-10-02T01:00:00Z"));
    expect(r3.newIssues).toBe(r1.newIssues);
    expect((await sentMap())[`${target.id}:license-status-SUSPENDED`]).toBe("2026-10");
    expect(await groupLogs("cred-digest:2026-10-02")).toBeGreaterThanOrEqual(1);
  });

  it("chạy job 2 lần cùng ngày, mỗi lần 1 vấn đề mới khác nhau → cả 2 tin đều gửi (khóa digest không trùng)", async () => {
    const day = new Date("2026-12-01T01:00:00Z");
    await credentialCheck(day); // tháng mới: gửi hết tồn đọng
    const n0 = await groupLogs("cred-digest:2026-12-01:");
    await newCred(H, target, { type: "SPECIALTY", name: "CC hết hạn A", issuedAt: "2020-01-01", expiresAt: "2021-01-01" });
    expect((await credentialCheck(day)).newIssues).toBe(1);
    const bId = await newCred(H, target, { type: "SPECIALTY", name: "CC hết hạn B", issuedAt: "2020-01-01", expiresAt: "2021-01-01" });
    expect((await credentialCheck(day)).newIssues).toBe(1);
    // Vấn đề B đã bị đánh dấu "đã báo" → phải có tin thứ 2 thật sự được ghi.
    expect((await sentMap())[`${target.id}:cred-expired-${bId}`]).toBe("2026-12");
    expect((await groupLogs("cred-digest:2026-12-01:")) - n0).toBe(2);
  });

  it("nhân viên đã nghỉ việc không nằm trong cảnh báo / job", async () => {
    expect((await putLicense(H, other, { ...LICENSE, status: "REVOKED" })).status).toBe(200);
    let items = (await (await alertsRoute.GET(req("/api/credentials/alerts", { cookie: H }), ctx())).json()).items;
    expect(items.some((a: { id: number }) => a.id === other.id)).toBe(true);
    await prisma.employee.update({ where: { id: other.id }, data: { active: false } });
    items = (await (await alertsRoute.GET(req("/api/credentials/alerts", { cookie: H }), ctx())).json()).items;
    expect(items.some((a: { id: number }) => a.id === other.id)).toBe(false);
    await credentialCheck(new Date("2027-01-05T01:00:00Z"));
    expect(Object.keys(await sentMap()).some((k) => k.startsWith(`${other.id}:`))).toBe(false);
    await prisma.employee.update({ where: { id: other.id }, data: { active: true } });
  });
});

describe("Danh mục & xóa tài khoản", () => {
  it("PATCH chuyên khoa kèm requiresLicense → bỏ qua, không lỗi", async () => {
    const s = await prisma.specialty.create({ data: { name: `QC chuyên khoa ${Date.now()}` } });
    specialtyId = s.id;
    const r = await specialtyRoute.PATCH(req(`/api/specialties/${s.id}`, { method: "PATCH", cookie: A, body: { requiresLicense: true, sortOrder: 3 } }), ctx({ id: String(s.id) }));
    expect(r.status).toBe(200);
    const item = (await r.json()).item;
    expect(item.requiresLicense).toBeUndefined();
    expect(item.sortOrder).toBe(3);
  });

  it("xóa tài khoản tạo nhầm (chưa có lịch sử) → xóa chứng chỉ (cascade) và thư mục data/credentials/<id>", async () => {
    const { employee: e } = await createEmployee(
      { code: `QC${Date.now() % 100000}`, name: "QC tạo nhầm", role: "EMPLOYEE", departmentId: target.departmentId, defaultShiftId: target.defaultShiftId } as never,
      null,
    );
    tempEmpId = e.id;
    const cid = await newCred(A, e);
    expect((await putLicense(A, e, LICENSE)).status).toBe(200);
    expect((await upload(A, e, cid, PDF)).status).toBe(200);
    expect(existsSync(credDir(e.id))).toBe(true);
    const r = await employeeRoute.DELETE(req(`/api/employees/${e.id}`, { method: "DELETE", cookie: A }), ctx(P(e)));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(existsSync(credDir(e.id))).toBe(false);
    expect(await prisma.credential.count({ where: { employeeId: e.id } })).toBe(0);
    expect(await prisma.practiceLicense.count({ where: { employeeId: e.id } })).toBe(0);
  });
});
