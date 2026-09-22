// QC v1.11.0 — ca đối kháng tích hợp: route tra cứu, lưu kết quả khi medinet lỗi, job medinet-check, giới hạn tần suất, cấu hình.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { __setMedinetFetch } from "@/lib/medinet";
import { medinetCheck } from "@/lib/medinet-check";
import { getSettings, getStringSetting, saveSettings, saveStringSetting } from "@/lib/settings";
import { resetRateLimits } from "@/lib/rate-limit";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as medinetRoute from "@/app/api/employees/[id]/license/medinet/route";
import * as lookupRoute from "@/app/api/medinet/lookup/route";
import * as medSettings from "@/app/api/settings/medinet/route";
import * as settingsRoute from "@/app/api/settings/route";

type E = Awaited<ReturnType<typeof byCode>>;
const fx = (f: string) => readFileSync(join(process.cwd(), "tests", "fixtures", f), "utf8");
const NUMBER = "0012345/BYT-CCHN";
const LICENSE = { number: NUMBER, issuedAt: "2015-03-15", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội tổng hợp", status: "ACTIVE", cmeCycleStart: "2025-03-15" };

type Mode = "ok" | "notfound" | "500";
let calls: { path: string; key?: string }[] = [];
let modeFor: (n: number) => Mode = () => "ok"; // n = thứ tự lần gọi trang tìm kiếm (0-based)
let searchN = 0;
function fake() {
  __setMedinetFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(/^https:\/\/[^/]+/, "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, key: body.key_word });
    if (path === "/chungchihanhnghey") {
      const m = modeFor(searchN++);
      if (m === "500") return new Response("Internal error", { status: 500 });
      if (m === "notfound") return new Response("<div>0 kết quả</div>");
      // Trả thẻ đúng số người ta tra (để job với nhiều số khác nhau vẫn "tìm thấy").
      return new Response(fx("medinet-search.html").replace("0012345/BYT-CCHN&nbsp;", () => `${body.key_word}&nbsp;`));
    }
    if (path === "/chungchihanhngheydetail") return new Response(fx("medinet-detail.html"));
    return new Response("", { status: 404 });
  }) as typeof fetch);
}
const searches = () => calls.filter((c) => c.path === "/chungchihanhnghey");

let hr: E, mgr: E, emp: E, admin: E, target: E;
let H: string, M: string, EM: string, A: string;
let jobPeople: E[] = [];
let inactive: E;
const created = new Set<number>();
const check = (cookie: string, e: E) => medinetRoute.POST(req(`/api/employees/${e.id}/license/medinet`, { method: "POST", cookie }), ctx({ id: String(e.id) }));
const lookup = (cookie: string, number: unknown) => lookupRoute.POST(req("/api/medinet/lookup", { method: "POST", cookie, body: { number } }), ctx());
const putMed = (cookie: string, body: unknown) => medSettings.PUT(req("/api/settings/medinet", { method: "PUT", cookie, body }), ctx());
const lic = (e: E) => prisma.practiceLicense.findUniqueOrThrow({ where: { employeeId: e.id } });
async function makeLicense(e: E, data: Partial<typeof LICENSE> & { medinetCheckedAt?: Date | null; medinetResult?: string | null } = {}) {
  await prisma.practiceLicense.deleteMany({ where: { employeeId: e.id } });
  await prisma.practiceLicense.create({ data: { employeeId: e.id, ...LICENSE, ...data } });
  created.add(e.id);
}
const medKinds = (issues: { kind: string }[]) => issues.map((i) => i.kind).filter((k) => k.startsWith("medinet")).sort();
let origName = "";
let origAbsent = 0;

beforeAll(async () => {
  [hr, mgr, emp, admin, target] = await Promise.all(["NV016", "NV003", "NV009", "NV001", "NV008"].map(byCode));
  [H, M, EM, A] = await Promise.all([hr, mgr, emp, admin].map((e) => sessionCookie(e.id)));
  jobPeople = await Promise.all(["NV004", "NV005", "NV006", "NV007", "NV010", "NV011"].map(byCode));
  inactive = await byCode("NV012");
  origName = target.name;
  origAbsent = (await getSettings()).absentAfterMinutes;
  await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn An" } });
  await saveStringSetting("clinicFacilityLicenses", "02222/HCM-GPHĐ");
  await saveSettings({ medinetAutoCheck: 1, medinetCheckDays: 30 });
  fake();
});
beforeEach(async () => {
  calls = [];
  searchN = 0;
  modeFor = () => "ok";
  resetRateLimits();
  await makeLicense(target);
});
afterAll(async () => {
  __setMedinetFetch(null);
  await prisma.practiceLicense.deleteMany({ where: { employeeId: { in: [...created] } } });
  await prisma.employee.update({ where: { id: target.id }, data: { name: origName } });
  await prisma.employee.update({ where: { id: inactive.id }, data: { active: true } });
  await saveStringSetting("clinicFacilityLicenses", "");
  await saveSettings({ medinetAutoCheck: 1, medinetCheckDays: 30, absentAfterMinutes: origAbsent });
  resetRateLimits();
});

describe("QC: medinet lỗi (HTTP 500) — giữ kết quả cũ, không sinh cảnh báo mới", () => {
  it("chưa có kết quả trước + 500 → ok:false, không có cảnh báo medinet-*", async () => {
    modeFor = () => "500";
    const r = await check(H, target);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.result).toMatchObject({ ok: false });
    expect(body.result.error).toContain("500");
    expect(medKinds(body.issues)).toEqual([]);
    expect((await lic(target)).verifiedAt).toBeNull();
  });

  it("lần trước có chỗ khác (tên) → 500 giữ nguyên record + cùng bộ cảnh báo, không thêm", async () => {
    await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn Bình" } });
    try {
      const first = await (await check(H, target)).json();
      expect(medKinds(first.issues)).toContain("medinet-name");
      modeFor = () => "500";
      const second = await (await check(H, target)).json();
      expect(second.result).toMatchObject({ ok: false, found: true, record: first.result.record, diffs: first.result.diffs });
      expect(medKinds(second.issues)).toEqual(medKinds(first.issues));
    } finally {
      await prisma.employee.update({ where: { id: target.id }, data: { name: "Nguyễn Văn An" } });
    }
  });

  it("lần trước 'không tìm thấy' → 500 chỉ còn cảnh báo 'không tìm thấy'", async () => {
    modeFor = () => "notfound";
    await check(H, target);
    modeFor = () => "500";
    const body = await (await check(H, target)).json();
    expect(medKinds(body.issues)).toEqual(["medinet-notfound"]);
  });

  it("lần tra lỗi không đẩy medinetCheckedAt — nếu không job sẽ 30 ngày sau mới tra lại", async () => {
    const now = new Date("2026-09-22T00:00:00Z");
    modeFor = () => "500";
    await medinetCheck(now);
    expect(searches().map((c) => c.key)).toContain(NUMBER);
    calls = [];
    modeFor = () => "ok";
    await medinetCheck(new Date(now.getTime() + 86_400_000)); // hôm sau medinet chạy lại
    expect(searches().map((c) => c.key)).toContain(NUMBER);
  });
});

describe("QC: job medinet-check", () => {
  beforeEach(async () => {
    // chỉ các GPHN của bài này đến hạn; target đã tra "hôm nay" để không lẫn
    await prisma.practiceLicense.update({ where: { employeeId: target.id }, data: { medinetCheckedAt: new Date("2026-09-22T00:00:00Z") } });
    for (const [i, e] of jobPeople.entries()) await makeLicense(e, { number: `00${i}9999/BYT-CCHN` });
    expect(await prisma.practiceLicense.count({ where: { employee: { active: true }, medinetCheckedAt: null } })).toBe(jobPeople.length);
  });
  afterAll(async () => {
    await prisma.practiceLicense.deleteMany({ where: { employeeId: { in: jobPeople.map((e) => e.id) } } });
  });

  it("toàn lỗi → dừng sau 3 lần", async () => {
    modeFor = () => "500";
    const r = await medinetCheck(new Date("2026-09-22T00:00:00Z"));
    expect(searches()).toHaveLength(3);
    expect(r).toMatchObject({ errors: 3, found: 0, notFound: 0 });
  });

  it("1 lần được rồi 3 lần lỗi liên tiếp → dừng (không tra tiếp cả danh sách)", async () => {
    modeFor = (n) => (n === 0 ? "ok" : "500");
    const r = await medinetCheck(new Date("2026-09-22T00:00:00Z"));
    expect(r).toMatchObject({ found: 1 });
    expect(searches()).toHaveLength(4);
  });

  it("nhân viên nghỉ việc (active=false) không được tra", async () => {
    await makeLicense(inactive, { number: "0077777/BYT-CCHN" });
    await prisma.employee.update({ where: { id: inactive.id }, data: { active: false } });
    try {
      const r = await medinetCheck(new Date("2026-09-22T00:00:00Z"));
      expect(searches().map((c) => c.key)).not.toContain("0077777/BYT-CCHN");
      expect(r).toMatchObject({ checked: jobPeople.length, found: jobPeople.length });
      expect((await lic(inactive)).medinetCheckedAt).toBeNull();
    } finally {
      await prisma.employee.update({ where: { id: inactive.id }, data: { active: true } });
      await prisma.practiceLicense.deleteMany({ where: { employeeId: inactive.id } });
    }
  });
});

describe("QC: route tra cứu điền form", () => {
  it("số < 3 ký tự (kể cả sau khi bỏ khoảng trắng) → 400, không gọi mạng", async () => {
    for (const n of ["ab", "  ab  ", "", 12345]) expect((await lookup(H, n)).status, JSON.stringify(n)).toBe(400);
    expect(calls).toEqual([]);
  });

  it("chỉ Nhân sự / Quản trị: nhân viên, quản lý 403; chưa đăng nhập 401; Quản trị 200", async () => {
    expect((await lookup(EM, NUMBER)).status).toBe(403);
    expect((await lookup(M, NUMBER)).status).toBe(403);
    expect((await lookup("", NUMBER)).status).toBe(401);
    const r = await lookup(A, NUMBER);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ found: true, candidates: 1 });
    expect(calls).toHaveLength(2);
  });

  it("không tìm thấy → 200 found:false; medinet 500 → 502", async () => {
    modeFor = () => "notfound";
    expect(await (await lookup(H, NUMBER)).json()).toMatchObject({ found: false, record: null, candidates: 0 });
    modeFor = () => "500";
    expect((await lookup(H, NUMBER)).status).toBe(502);
  });

  it("giới hạn: 10 lượt / phút / người (dùng chung 2 route) → lượt 11 là 429; người khác vẫn tra được (máy chủ 30 lượt / phút)", async () => {
    for (let i = 0; i < 10; i++) expect((await lookup(H, NUMBER)).status, `lượt ${i + 1}`).toBe(200);
    expect((await lookup(H, NUMBER)).status).toBe(429);
    expect((await check(H, target)).status).toBe(429);
    expect((await lookup(A, NUMBER)).status).toBe(200);
    resetRateLimits();
    expect((await lookup(A, NUMBER)).status).toBe(200);
  });
});

describe("QC: cấu hình medinet", () => {
  it("số ngày 5 / 400 / 30.5, bật-tắt = 2 hoặc true → 400; Nhân sự 403 (cả GET)", async () => {
    for (const b of [{ medinetCheckDays: 5 }, { medinetCheckDays: 400 }, { medinetCheckDays: 30.5 }, { medinetAutoCheck: 2 }, { medinetAutoCheck: true }]) {
      expect((await putMed(A, b)).status, JSON.stringify(b)).toBe(400);
    }
    expect((await medSettings.GET(req("/api/settings/medinet", { cookie: H }), ctx())).status).toBe(403);
    expect(await getSettings()).toMatchObject({ medinetAutoCheck: 1, medinetCheckDays: 30 });
  });

  it("chỉ gửi clinicFacilityLicenses → bật-tắt và số ngày giữ nguyên", async () => {
    await putMed(A, { medinetAutoCheck: 0, medinetCheckDays: 45 });
    const r = await putMed(A, { clinicFacilityLicenses: "02222/HCM-GPHĐ,, ;04444" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ medinetAutoCheck: 0, medinetCheckDays: 45, clinicFacilityLicenses: "02222/HCM-GPHĐ, 04444" });
    // chỉ gửi số ngày → chuỗi GPHĐ giữ nguyên
    expect(await (await putMed(A, { medinetCheckDays: 60 })).json()).toEqual({ medinetAutoCheck: 0, medinetCheckDays: 60, clinicFacilityLicenses: "02222/HCM-GPHĐ, 04444" });
    // body rỗng → không đổi gì
    expect(await (await putMed(A, {})).json()).toEqual({ medinetAutoCheck: 0, medinetCheckDays: 60, clinicFacilityLicenses: "02222/HCM-GPHĐ, 04444" });
    await putMed(A, { medinetAutoCheck: 1, medinetCheckDays: 30, clinicFacilityLicenses: "02222/HCM-GPHĐ" });
  });

  it("PUT /api/settings (ngưỡng) vẫn chạy và không đặt lại cấu hình medinet", async () => {
    await putMed(A, { medinetAutoCheck: 0, medinetCheckDays: 90 });
    const r = await settingsRoute.PUT(req("/api/settings", { method: "PUT", cookie: A, body: { absentAfterMinutes: origAbsent === 45 ? 50 : 45 } }), ctx());
    expect(r.status).toBe(200);
    const s = (await r.json()).settings;
    expect(s).toMatchObject({ absentAfterMinutes: origAbsent === 45 ? 50 : 45, medinetAutoCheck: 0, medinetCheckDays: 90 });
    expect(await getStringSetting("clinicFacilityLicenses")).toBe("02222/HCM-GPHĐ");
    // ngưỡng ngoài miền qua route chung cũng bị chặn
    expect((await settingsRoute.PUT(req("/api/settings", { method: "PUT", cookie: A, body: { medinetCheckDays: 5 } }), ctx())).status).toBe(400);
    await saveSettings({ medinetAutoCheck: 1, medinetCheckDays: 30, absentAfterMinutes: origAbsent });
  });
});
