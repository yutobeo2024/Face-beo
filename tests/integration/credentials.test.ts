// v1.9.0: hồ sơ hành nghề — GPHN, văn bằng / chứng chỉ / CME kèm file, quyền, cảnh báo Zalo nhóm minh bạch.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dataDir } from "@/lib/storage";
import { credentialCheck } from "@/lib/jobs";
import { BASE, byCode, ctx, req, sessionCookie } from "./helpers";

import * as licenseRoute from "@/app/api/employees/[id]/license/route";
import * as verifyRoute from "@/app/api/employees/[id]/license/verify/route";
import * as credsRoute from "@/app/api/employees/[id]/credentials/route";
import * as credRoute from "@/app/api/employees/[id]/credentials/[cid]/route";
import * as fileRoute from "@/app/api/employees/[id]/credentials/[cid]/file/route";
import * as alertsRoute from "@/app/api/credentials/alerts/route";
import * as jobTitleRoute from "@/app/api/job-titles/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
let hr: E, mgr: E, target: E, other: E, admin: E;
let H: string, M: string, T: string, O: string;
let titleId: number;

const P = (e: E) => ({ id: String(e.id) });
const LICENSE = { number: "0015578/BYT-CCHN", issuedAt: "2013-06-10", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội", status: "ACTIVE" };
const PDF = new TextEncoder().encode("%PDF-1.4\n% test\n");
const upload = (cookie: string, e: E, cid: number, body: Uint8Array, name = "bang.pdf") =>
  fileRoute.POST(
    new NextRequest(new URL(`/api/employees/${e.id}/credentials/${cid}/file`, BASE), {
      method: "POST",
      headers: { cookie, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) },
      body: new Uint8Array(body),
    }),
    ctx({ id: String(e.id), cid: String(cid) }),
  );
const putLicense = (cookie: string, e: E, body: unknown) => licenseRoute.PUT(req(`/api/employees/${e.id}/license`, { method: "PUT", cookie, body }), ctx(P(e)));
const getProfile = (cookie: string, e: E) => licenseRoute.GET(req(`/api/employees/${e.id}/license`, { cookie }), ctx(P(e)));
const addCred = (cookie: string, e: E, body: unknown) => credsRoute.POST(req(`/api/employees/${e.id}/credentials`, { method: "POST", cookie, body }), ctx(P(e)));
const groupLogs = (part: string) => prisma.notificationLog.count({ where: { messageType: "GROUP_EVENT", dedupeKey: { contains: part } } });

beforeAll(async () => {
  [hr, mgr, target, other, admin] = await Promise.all(["NV016", "NV003", "NV008", "NV009", "NV001"].map(byCode)); // NV008 thuộc phòng NV003 quản lý
  [H, M, T, O] = await Promise.all([hr, mgr, target, other].map((e) => sessionCookie(e.id)));
  const t = await prisma.jobTitle.create({ data: { name: `Bác sĩ test ${Date.now()}`, requiresLicense: false } });
  titleId = t.id;
  await prisma.employee.update({ where: { id: target.id }, data: { jobTitleId: titleId } });
});
afterAll(async () => {
  await prisma.credential.deleteMany({ where: { employeeId: { in: [target.id, other.id] } } });
  await prisma.practiceLicense.deleteMany({ where: { employeeId: { in: [target.id, other.id] } } });
  await prisma.employee.update({ where: { id: target.id }, data: { jobTitleId: null } });
  await prisma.jobTitle.delete({ where: { id: titleId } });
});

describe("GPHN", () => {
  it("chức danh bắt buộc GPHN (tích trong Cấu hình) → cảnh báo thiếu GPHN", async () => {
    const A = await sessionCookie(admin.id);
    const r = await jobTitleRoute.PATCH(req(`/api/job-titles/${titleId}`, { method: "PATCH", cookie: A, body: { requiresLicense: true } }), ctx({ id: String(titleId) }));
    expect(r.status).toBe(200);
    const p = await (await getProfile(H, target)).json();
    expect(p.requiresLicense).toBe(true);
    expect(p.issues.map((i: { kind: string }) => i.kind)).toContain("license-missing");
    const alerts = await (await alertsRoute.GET(req("/api/credentials/alerts", { cookie: H }), ctx())).json();
    expect(alerts.items.some((a: { id: number }) => a.id === target.id)).toBe(true);
  });

  it("có số GPHN thì bắt buộc đủ trường; HR lưu được, cmeCycleStart mặc định = ngày gia hạn / ngày cấp", async () => {
    expect((await putLicense(H, target, { number: LICENSE.number })).status).toBe(400);
    expect((await putLicense(H, target, { ...LICENSE, scope: "" })).status).toBe(400);
    const r = await putLicense(H, target, { ...LICENSE, renewedAt: "2024-01-15" });
    expect(r.status).toBe(200);
    expect((await r.json()).license.cmeCycleStart).toBe("2024-01-15");
    const again = await putLicense(H, target, LICENSE);
    expect((await again.json()).license.cmeCycleStart).toBe("2013-06-10");
  });

  it("quyền: quản lý (kể cả phòng mình) không xem / không sửa; chính chủ chỉ xem; người khác không xem", async () => {
    expect((await getProfile(M, target)).status).toBe(403);
    expect((await putLicense(M, target, LICENSE)).status).toBe(403);
    const self = await getProfile(T, target);
    expect(self.status).toBe(200);
    expect((await self.json()).canEdit).toBe(false);
    expect((await putLicense(T, target, LICENSE)).status).toBe(403);
    expect((await getProfile(O, target)).status).toBe(403);
    expect((await alertsRoute.GET(req("/api/credentials/alerts", { cookie: M }), ctx())).status).toBe(403);
    expect((await (await getProfile(H, target)).json()).canEdit).toBe(true);
  });

  it("đối chiếu medinet ghi verifiedAt; tình trạng Đình chỉ → tin nhóm minh bạch ngay (một lần khi đổi)", async () => {
    expect((await verifyRoute.POST(req(`/api/employees/${target.id}/license/verify`, { method: "POST", cookie: H }), ctx(P(target)))).status).toBe(200);
    expect((await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: target.id } })).verifiedById).toBe(hr.id);
    expect((await verifyRoute.POST(req(`/api/employees/${other.id}/license/verify`, { method: "POST", cookie: H }), ctx(P(other)))).status).toBe(400);
    const before = await groupLogs(`license-status:${target.id}`);
    await putLicense(H, target, { ...LICENSE, status: "SUSPENDED" });
    await putLicense(H, target, { ...LICENSE, status: "SUSPENDED", scope: "Nội tổng quát" });
    expect((await groupLogs(`license-status:${target.id}`)) - before).toBeGreaterThanOrEqual(1);
    const n = await groupLogs(`license-status:${target.id}`);
    await putLicense(H, target, { ...LICENSE, status: "SUSPENDED" }); // không đổi tình trạng → không gửi lại
    expect(await groupLogs(`license-status:${target.id}`)).toBe(n);
    await putLicense(H, target, LICENSE);
  });
});

describe("Văn bằng / chứng chỉ / CME kèm file", () => {
  let cid = 0;

  it("CME thiếu số tiết → 400; thêm CME → tiến độ CME cập nhật", async () => {
    expect((await addCred(H, target, { type: "CME", name: "Hồi sức cấp cứu" })).status).toBe(400);
    expect((await addCred(M, target, { type: "DEGREE", name: "Bác sĩ đa khoa" })).status).toBe(403);
    const r = await addCred(H, target, { type: "CME", name: "Hồi sức cấp cứu", cmeHours: 24, issuedAt: "2026-03-01" });
    expect(r.status).toBe(201);
    cid = (await r.json()).item.id;
    const p = await (await getProfile(H, target)).json();
    expect(p.cme.twoYearHours).toBe(24);
    expect(p.cme.cycle.hours).toBe(24);
    // PATCH đổi sang loại khác: số tiết bị bỏ.
    const other = await addCred(H, target, { type: "CME", name: "Tạm", cmeHours: 8, issuedAt: "2026-01-01" });
    const oid = (await other.json()).item.id;
    const pr = await credRoute.PATCH(req(`/api/employees/${target.id}/credentials/${oid}`, { method: "PATCH", cookie: H, body: { type: "DEGREE" } }), ctx({ id: String(target.id), cid: String(oid) }));
    expect((await pr.json()).item.cmeHours).toBeNull();
    await credRoute.DELETE(req(`/api/employees/${target.id}/credentials/${oid}`, { method: "DELETE", cookie: H }), ctx({ id: String(target.id), cid: String(oid) }));
  });

  it("tải lên: PDF hợp lệ; file giả / quá 10 MB → 400; xem file: chính chủ và HR, người khác 403", async () => {
    expect((await upload(H, target, cid, new TextEncoder().encode("MZ fake exe"))).status).toBe(400);
    expect((await upload(H, target, cid, new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25))).status).toBe(400);
    expect((await upload(M, target, cid, PDF)).status).toBe(403);
    expect((await upload(H, target, cid, PDF)).status).toBe(200);
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    expect(row.fileMime).toBe("application/pdf");
    expect(row.fileName).toBe("bang.pdf");
    const path = join(dataDir(), "credentials", String(target.id), row.fileKey!);
    expect(existsSync(path)).toBe(true);
    const get = (cookie: string) => fileRoute.GET(req(`/api/employees/${target.id}/credentials/${cid}/file`, { cookie }), ctx({ id: String(target.id), cid: String(cid) }));
    const own = await get(T);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PDF);
    expect((await get(O)).status).toBe(403);
    expect((await get(M)).status).toBe(403);
    // Chứng chỉ của người khác qua đường dẫn người này → 404.
    expect((await fileRoute.GET(req(`/api/employees/${other.id}/credentials/${cid}/file`, { cookie: H }), ctx({ id: String(other.id), cid: String(cid) }))).status).toBe(404);
    // Thay file: file cũ bị xóa.
    expect((await upload(H, target, cid, PDF, "moi.pdf")).status).toBe(200);
    expect(existsSync(path)).toBe(false);
    // Hồ sơ trả về không lộ fileKey.
    const p = await (await getProfile(T, target)).json();
    const item = p.credentials.find((c: { id: number }) => c.id === cid);
    expect(item.hasFile).toBe(true);
    expect(item.fileKey).toBeUndefined();
  });

  it("xóa chứng chỉ xóa luôn file trên đĩa", async () => {
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: cid } });
    const path = join(dataDir(), "credentials", String(target.id), row.fileKey!);
    expect(existsSync(path)).toBe(true);
    const r = await credRoute.DELETE(req(`/api/employees/${target.id}/credentials/${cid}`, { method: "DELETE", cookie: H }), ctx({ id: String(target.id), cid: String(cid) }));
    expect(r.status).toBe(200);
    expect(existsSync(path)).toBe(false);
  });
});

describe("job credential-check", () => {
  it("gom vấn đề mới thành tin tổng hợp; cùng tháng không nhắc lại; sang tháng mới nhắc lại; bỏ 'chưa đối chiếu'", async () => {
    await prisma.appSetting.deleteMany({ where: { key: "credentialAlertSent" } });
    await putLicense(H, target, { ...LICENSE, expiresAt: "2026-10-01" });
    const digests = () => prisma.notificationLog.findMany({ where: { messageType: "GROUP_EVENT", dedupeKey: { contains: "cred-digest:" } }, orderBy: { id: "asc" } });
    const n0 = (await digests()).length;
    const r1 = await credentialCheck(new Date("2026-09-21T00:30:00Z"));
    expect(r1.newIssues).toBeGreaterThan(0);
    const d1 = (await digests()).slice(n0);
    expect(d1.length).toBeGreaterThanOrEqual(1);
    const text = d1.map((l) => l.payload).join(" ");
    expect(text).toContain(`${target.code} — ${target.name}`);
    expect(text).toContain("GPHN hết hạn ngày 01/10/2026");
    expect(text).not.toContain("medinet");
    const sent = JSON.parse((await prisma.appSetting.findUniqueOrThrow({ where: { key: "credentialAlertSent" } })).value);
    expect(sent[`${target.id}:license-expiring`]).toBe("2026-09");
    // Chạy lại cùng tháng: không có vấn đề mới, không gửi.
    expect((await credentialCheck(new Date("2026-09-22T00:30:00Z"))).newIssues).toBe(0);
    expect((await digests()).length).toBe(n0 + d1.length);
    // Sang tháng: nhắc lại.
    expect((await credentialCheck(new Date("2026-10-01T00:30:00Z"))).newIssues).toBeGreaterThan(0);
    await prisma.appSetting.deleteMany({ where: { key: "credentialAlertSent" } });
  });

  it("Nhân sự không tự cập nhật hồ sơ hành nghề của mình; Quản trị thì được", async () => {
    expect((await putLicense(H, hr, LICENSE)).status).toBe(403);
    const A = await sessionCookie(admin.id);
    expect((await putLicense(A, admin, { ...LICENSE, number: "0000001/BYT-CCHN" })).status).toBe(200);
    await prisma.practiceLicense.deleteMany({ where: { employeeId: admin.id } });
  });
});
