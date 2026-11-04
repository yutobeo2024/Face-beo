// v1.25.0: mục "Dashboard CSKH" → /api/cskh/sso ký vé đăng nhập một lần sang dashboard bot Zalo (dự án Zalo-hermess).
// Kiểm: chưa đăng nhập → về /login; không quyền → 403; cskh.view → vé vai staff; cskh.admin / ADMIN → vé vai admin;
// thiếu cấu hình → 503; lượt mở do trang khác khởi xướng → 403; có ghi nhật ký CSKH_SSO.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DEFAULT_MATRIX, saveMatrix, invalidatePermissionCache } from "@/lib/permissions";
import { byCode, ctx, req, sessionCookie } from "./helpers";
import * as ssoRoute from "@/app/api/cskh/sso/route";

const SECRET = "integration-test-secret-0123456789abcdef";
const BASE_URL = "https://dashboard.example.vn";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, employee: E;
let adminCookie: string, employeeCookie: string;

const defaults = () => JSON.parse(JSON.stringify(DEFAULT_MATRIX)) as typeof DEFAULT_MATRIX;
const open = (cookie?: string, headers?: Record<string, string>) => ssoRoute.GET(req("/api/cskh/sso", { cookie, headers }), ctx());
const roleOf = (location: string) => {
  const t = new URL(location).searchParams.get("t")!;
  return Buffer.from(t.split(".")[0], "base64url").toString("utf8").split("|");
};

beforeAll(async () => {
  admin = await byCode("NV001");
  employee = await byCode("NV008");
  adminCookie = await sessionCookie(admin.id);
  employeeCookie = await sessionCookie(employee.id);
});

afterEach(async () => {
  await saveMatrix(defaults());
  invalidatePermissionCache();
  process.env.CSKH_SSO_SECRET = SECRET;
  process.env.CSKH_DASHBOARD_URL = BASE_URL;
});

afterAll(async () => {
  await saveMatrix(defaults());
  delete process.env.CSKH_SSO_SECRET;
  delete process.env.CSKH_DASHBOARD_URL;
});

describe("Dashboard CSKH — đăng nhập một lần", () => {
  it("chưa đăng nhập thì chuyển về trang đăng nhập, quay lại đúng mục này", async () => {
    process.env.CSKH_SSO_SECRET = SECRET;
    process.env.CSKH_DASHBOARD_URL = BASE_URL;
    const res = await open();
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/api/cskh/sso");
  });

  it("nhân viên chưa được cấp quyền thì bị chặn", async () => {
    const res = await open(employeeCookie);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("cskh.view → vé vai lễ tân mang mã nhân viên, có nhật ký", async () => {
    const m = defaults();
    m.EMPLOYEE = [...m.EMPLOYEE, "cskh.view"];
    await saveMatrix(m);
    const before = await prisma.auditLog.count({ where: { action: "CSKH_SSO", actorId: employee.id } });
    const res = await open(employeeCookie);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith(`${BASE_URL}/dashboard/sso?t=`)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const payload = roleOf(loc);
    expect(payload[0]).toBe("v1");
    expect(payload[1]).toBe("staff");
    expect(payload[4]).toBe(employee.code);
    expect(await prisma.auditLog.count({ where: { action: "CSKH_SSO", actorId: employee.id } })).toBe(before + 1);
  });

  it("cskh.admin → vé vai admin; ADMIN luôn ra admin", async () => {
    const m = defaults();
    m.EMPLOYEE = [...m.EMPLOYEE, "cskh.admin"];
    await saveMatrix(m);
    expect(roleOf((await open(employeeCookie)).headers.get("location")!)[1]).toBe("admin");
    expect(roleOf((await open(adminCookie)).headers.get("location")!)[1]).toBe("admin");
  });

  it("mỗi lần bấm là một vé mới", async () => {
    const a = (await open(adminCookie)).headers.get("location");
    const b = (await open(adminCookie)).headers.get("location");
    expect(a).not.toBe(b);
  });

  it("thiếu hoặc yếu cấu hình thì báo 503, không cấp vé", async () => {
    for (const [secret, url] of [["", BASE_URL], ["short", BASE_URL], [SECRET, ""], [SECRET, "http://dashboard.example.vn"]]) {
      process.env.CSKH_SSO_SECRET = secret;
      process.env.CSKH_DASHBOARD_URL = url;
      const res = await open(adminCookie);
      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("lượt mở do trang khác khởi xướng thì bị chặn; từ chính Face Beo hoặc gõ địa chỉ thì được", async () => {
    expect((await open(adminCookie, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await open(adminCookie, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await open(adminCookie, { "sec-fetch-site": "same-origin" })).status).toBe(302);
    expect((await open(adminCookie, { "sec-fetch-site": "none" })).status).toBe(302);
  });
});
