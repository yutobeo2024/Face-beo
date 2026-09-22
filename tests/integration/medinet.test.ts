// v1.11.0: tự tra cứu GPHN trên medinet — route, lưu kết quả, cảnh báo, job; mạng được giả lập bằng HTML mẫu ẩn danh.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { __setMedinetFetch } from "@/lib/medinet";
import { medinetCheck } from "@/lib/medinet-check";
import { saveSettings, saveStringSetting } from "@/lib/settings";
import { resetRateLimits } from "@/lib/rate-limit";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as medinetRoute from "@/app/api/employees/[id]/license/medinet/route";
import * as lookupRoute from "@/app/api/medinet/lookup/route";
import * as alertsRoute from "@/app/api/credentials/alerts/route";
import * as settingsRoute from "@/app/api/settings/medinet/route";
import * as licenseRoute from "@/app/api/employees/[id]/license/route";

type E = Awaited<ReturnType<typeof byCode>>;
let hr: E, mgr: E, target: E, admin: E;
let H: string, M: string, A: string;
const fx = (f: string) => readFileSync(join(process.cwd(), "tests", "fixtures", f), "utf8");
let calls: string[] = [];
let mode: "ok" | "notfound" | "down" = "ok";

function fakeMedinet() {
  __setMedinetFetch((async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u.replace(/^https:\/\/[^/]+/, ""));
    if (mode === "down") throw new Error("ECONNRESET");
    if (u.endsWith("/chungchihanhnghey")) return new Response(mode === "notfound" ? "<div>0 kết quả</div>" : fx("medinet-search.html"), { status: 200 });
    if (u.endsWith("/chungchihanhngheydetail")) return new Response(fx("medinet-detail.html"), { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof fetch);
}
const LICENSE = { number: "0012345/BYT-CCHN", issuedAt: "2015-03-15", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội tổng hợp", status: "ACTIVE", cmeCycleStart: "2025-03-15" };
const check = (cookie: string, e: E) => medinetRoute.POST(req(`/api/employees/${e.id}/license/medinet`, { method: "POST", cookie }), ctx({ id: String(e.id) }));
const stored = async (e: E) => JSON.parse((await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: e.id } })).medinetResult ?? "null");

beforeAll(async () => {
  [hr, mgr, target, admin] = await Promise.all(["NV016", "NV003", "NV008", "NV001"].map(byCode));
  [H, M, A] = await Promise.all([hr, mgr, admin].map((e) => sessionCookie(e.id)));
  await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn An" } });
  await saveStringSetting("clinicFacilityLicenses", "02222/HCM-GPHĐ");
  fakeMedinet();
});
beforeEach(async () => {
  calls = [];
  mode = "ok";
  resetRateLimits();
  await prisma.practiceLicense.deleteMany({ where: { employeeId: target.id } });
  await prisma.practiceLicense.create({ data: { employeeId: target.id, ...LICENSE } });
});
afterAll(async () => {
  __setMedinetFetch(null);
  await prisma.practiceLicense.deleteMany({ where: { employeeId: target.id } });
  await prisma.employee.update({ where: { id: target.id }, data: { name: target.name } });
  await saveStringSetting("clinicFacilityLicenses", "");
  await saveSettings({ medinetAutoCheck: 1, medinetCheckDays: 30 });
});

describe("Tra cứu tự động (nút)", () => {
  it("khớp → lưu kết quả, tự ghi 'đã đối chiếu'; chỉ còn cảnh báo 'đăng ký nơi khác'", async () => {
    const r = await check(H, target);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.result).toMatchObject({ ok: true, found: true, diffs: [], atClinic: true });
    expect(calls).toEqual(["/chungchihanhnghey", "/chungchihanhngheydetail"]);
    const lic = await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: target.id } });
    expect(lic.verifiedAt).not.toBeNull();
    expect(lic.verifiedById).toBe(hr.id);
    const kinds = body.issues.map((i: { kind: string }) => i.kind);
    expect(kinds.some((k: string) => k.startsWith("medinet-elsewhere-"))).toBe(true);
    expect(kinds).not.toContain("license-unverified");
  });

  it("hồ sơ khác medinet (tên, tình trạng) → không ghi 'đã đối chiếu', cảnh báo nghiêm trọng vào dashboard", async () => {
    await prisma.practiceLicense.update({ where: { employeeId: target.id }, data: { status: "SUSPENDED" } });
    await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn Bình" } });
    try {
      const body = await (await check(H, target)).json();
      expect(body.result.diffs.map((d: { field: string }) => d.field)).toEqual(["name", "status"]);
      expect((await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: target.id } })).verifiedAt).toBeNull();
      const alerts = await (await alertsRoute.GET(req("/api/credentials/alerts", { cookie: H }), ctx())).json();
      const mine = alerts.items.find((a: { id: number }) => a.id === target.id);
      expect(mine.issues.map((i: { kind: string }) => i.kind)).toEqual(expect.arrayContaining(["medinet-name", "medinet-diff-status"]));
    } finally {
      await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn An" } });
    }
  });

  it("không tìm thấy → cảnh báo 'không tìm thấy'; medinet lỗi → giữ kết quả cũ, ghi lỗi, không đổi cảnh báo", async () => {
    mode = "notfound";
    expect((await (await check(H, target)).json()).result).toMatchObject({ ok: true, found: false });
    mode = "ok";
    await check(H, target);
    mode = "down";
    const body = await (await check(H, target)).json();
    expect(body.result).toMatchObject({ ok: false, found: true });
    expect(body.result.error).toContain("ECONNRESET");
    expect((await stored(target)).record.name).toBe("Nguyễn Văn An"); // kết quả cũ còn nguyên
  });

  it("Nhân sự sửa hồ sơ cho khớp → cảnh báo cũ hết ngay (so lại, không gọi mạng); đổi số GPHN → bỏ kết quả của số cũ", async () => {
    await prisma.practiceLicense.update({ where: { employeeId: target.id }, data: { scope: "Nội khoa" } });
    const first = await (await check(H, target)).json();
    expect(first.result.diffs.map((d: { field: string }) => d.field)).toEqual(["scope"]);
    calls = [];
    const put = (body: object) => licenseRoute.PUT(req(`/api/employees/${target.id}/license`, { method: "PUT", cookie: H, body }), ctx({ id: String(target.id) }));
    expect((await put({ ...LICENSE })).status).toBe(200); // sửa phạm vi cho đúng medinet
    expect(calls).toEqual([]);
    expect((await stored(target)).diffs).toEqual([]);
    expect((await put({ ...LICENSE, number: "0099999/BYT-CCHN" })).status).toBe(200);
    const lic = await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: target.id } });
    expect([lic.medinetResult, lic.medinetCheckedAt]).toEqual([null, null]);
  });

  it("quyền: quản lý 403; chưa có GPHN 404", async () => {
    expect((await check(M, target)).status).toBe(403);
    await prisma.practiceLicense.deleteMany({ where: { employeeId: target.id } });
    expect((await check(H, target)).status).toBe(404);
  });
});

describe("Tra để điền sẵn form", () => {
  it("trả dữ liệu medinet theo số; quản lý 403; medinet lỗi → 502", async () => {
    const r = await lookupRoute.POST(req("/api/medinet/lookup", { method: "POST", cookie: H, body: { number: "0012345/BYT-CCHN" } }), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).record).toMatchObject({ name: "Nguyễn Văn An", issuedAt: "2015-03-15", issuer: "Bộ Y tế" });
    expect((await lookupRoute.POST(req("/api/medinet/lookup", { method: "POST", cookie: M, body: { number: "0012345/BYT-CCHN" } }), ctx())).status).toBe(403);
    mode = "down";
    expect((await lookupRoute.POST(req("/api/medinet/lookup", { method: "POST", cookie: H, body: { number: "0012345/BYT-CCHN" } }), ctx())).status).toBe(502);
  });
});

describe("Job medinet-check + cấu hình", () => {
  it("chỉ tra người đến hạn; tắt thì bỏ qua; cấu hình qua API (chỉ Quản trị)", async () => {
    const now = new Date("2026-09-22T00:00:00Z");
    const r1 = await medinetCheck(now);
    expect(r1).toMatchObject({ checked: expect.any(Number), found: expect.any(Number) });
    expect(calls).toContain("/chungchihanhnghey");
    expect((await prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: target.id } })).medinetCheckedAt).not.toBeNull();
    calls = [];
    await medinetCheck(new Date(now.getTime() + 5 * 86_400_000)); // chưa tới 30 ngày
    expect(calls.filter((c) => c === "/chungchihanhnghey")).toHaveLength(0);
    await medinetCheck(new Date(now.getTime() + 31 * 86_400_000)); // quá hạn → tra lại
    expect(calls.filter((c) => c === "/chungchihanhnghey").length).toBeGreaterThan(0);

    expect((await settingsRoute.PUT(req("/api/settings/medinet", { method: "PUT", cookie: H, body: { medinetAutoCheck: 0 } }), ctx())).status).toBe(403);
    const put = await settingsRoute.PUT(req("/api/settings/medinet", { method: "PUT", cookie: A, body: { medinetAutoCheck: 0, clinicFacilityLicenses: " 02222/HCM-GPHĐ ; 03333 " } }), ctx());
    expect(await put.json()).toMatchObject({ medinetAutoCheck: 0, medinetCheckDays: 30, clinicFacilityLicenses: "02222/HCM-GPHĐ, 03333" });
    calls = [];
    expect(await medinetCheck(new Date(now.getTime() + 90 * 86_400_000))).toMatchObject({ skipped: expect.any(String) });
    expect(calls).toEqual([]);
  });
});
