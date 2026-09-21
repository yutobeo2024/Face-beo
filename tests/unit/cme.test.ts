// v1.9.0: tính CME (TT 32/2023) và cảnh báo hồ sơ hành nghề — hàm thuần.
import { describe, expect, it } from "vitest";
import { cmeStatus, credentialSchema, licenseIssues, licenseSchema } from "@/lib/credentials";

const S = { cmeTwoYearHours: 48, cmeCycleHours: 120, cmeCycleYears: 5, credentialWarnDays: 90 };
let seq = 0;
const cme = (issuedAt: string, cmeHours: number) => ({ id: ++seq, type: "CME", name: `CME ${issuedAt}`, issuedAt, expiresAt: null, cmeHours });

describe("cmeStatus", () => {
  it("cửa sổ 24 tháng: chỉ cộng chứng chỉ cấp sau (hôm nay − 2 năm), bỏ ngày tương lai", () => {
    const r = cmeStatus(null, [cme("2024-09-20", 10), cme("2024-09-22", 12), cme("2026-01-01", 30), cme("2026-12-01", 99)], S, "2026-09-21");
    expect(r.twoYearFrom).toBe("2024-09-21");
    expect(r.twoYearHours).toBe(42);
    expect(r.cycle).toBeNull();
  });

  it("chu kỳ 5 năm theo mốc; chứng chỉ chu kỳ trước không cộng sang", () => {
    // Mốc 2020-03-01 → chu kỳ 1: 2020-03-01..2025-03-01; hôm nay 2026-09-21 nằm ở chu kỳ 2: 2025-03-01..2030-03-01.
    const r = cmeStatus("2020-03-01", [cme("2024-06-01", 100), cme("2025-02-28", 20), cme("2025-03-01", 16), cme("2026-05-01", 24)], S, "2026-09-21");
    expect(r.cycle).toMatchObject({ from: "2025-03-01", to: "2030-03-01", hours: 40 });
    expect(r.cycle!.daysLeft).toBeGreaterThan(1200);
  });

  it("ngưỡng cấu hình được (chu kỳ 3 năm)", () => {
    const r = cmeStatus("2024-01-01", [cme("2026-02-01", 10)], { ...S, cmeCycleYears: 3, cmeCycleHours: 60 }, "2026-09-21");
    expect(r.cycle).toMatchObject({ from: "2024-01-01", to: "2027-01-01", hours: 10 });
    expect(r.cycleRequired).toBe(60);
  });
});

describe("licenseIssues", () => {
  const base = { status: "ACTIVE", issuedAt: "2015-01-01", expiresAt: null, cmeCycleStart: "2022-01-01", verifiedAt: new Date("2026-09-01") };
  const today = "2026-09-21";

  it("chức danh bắt buộc mà chưa có GPHN → danger; không bắt buộc → không báo", () => {
    expect(licenseIssues({ requiresLicense: true, license: null, credentials: [], settings: S, today }).map((i) => i.kind)).toEqual(["license-missing"]);
    expect(licenseIssues({ requiresLicense: false, license: null, credentials: [], settings: S, today })).toEqual([]);
  });

  it("đủ CME, GPHN hoạt động, mới đối chiếu → không có vấn đề", () => {
    const creds = [cme("2025-01-01", 30), cme("2026-01-01", 30), cme("2023-01-01", 70)];
    expect(licenseIssues({ requiresLicense: true, license: base, credentials: creds, settings: S, today })).toEqual([]);
  });

  it("tình trạng, hết hạn, thiếu CME 2 năm, chu kỳ sắp hết thiếu tiết, chưa đối chiếu, chứng chỉ hết hạn", () => {
    const issues = licenseIssues({
      requiresLicense: true,
      license: { status: "SUSPENDED", issuedAt: "2015-01-01", expiresAt: "2026-10-15", cmeCycleStart: "2021-12-01", verifiedAt: null },
      credentials: [cme("2025-06-01", 20), { id: 900, type: "RADIATION", name: "An toàn bức xạ", issuedAt: "2021-01-01", expiresAt: "2026-01-01", cmeHours: null }],
      settings: S,
      today,
    });
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toEqual(["license-status-SUSPENDED", "license-expiring", "cme-2y", "cme-cycle", "license-unverified", "cred-expired-900"]);
    expect(issues.find((i) => i.kind === "cme-2y")!.text).toContain("20/48");
    expect(issues.find((i) => i.kind === "cme-cycle")!.text).toContain("20/120");
  });
});

describe("zod", () => {
  it("GPHN: có số thì bắt buộc đủ trường", () => {
    expect(licenseSchema.safeParse({ number: "0015578/BYT-CCHN" }).success).toBe(false);
    const ok = licenseSchema.safeParse({ number: "0015578/BYT-CCHN", issuedAt: "2013-06-10", issuer: "Bộ Y tế", subject: "Bác sĩ", scope: "Khám bệnh, chữa bệnh chuyên khoa Nội", status: "ACTIVE", expiresAt: "" });
    expect(ok.success && ok.data.expiresAt).toBeNull();
  });
  it("CME cần số tiết và ngày cấp", () => {
    expect(credentialSchema.safeParse({ type: "CME", name: "Hồi sức" }).success).toBe(false);
    expect(credentialSchema.safeParse({ type: "CME", name: "Hồi sức", cmeHours: "24", issuedAt: "2026-01-01" }).success).toBe(true);
    expect(credentialSchema.safeParse({ type: "DEGREE", name: "Bác sĩ đa khoa" }).success).toBe(true);
  });
});
