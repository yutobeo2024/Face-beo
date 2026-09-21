/**
 * Quyền với hồ sơ hành nghề (v1.9.0): xem — Nhân sự / Quản trị (theo vai trò, giống thông tin cá nhân) và chính chủ;
 * sửa — chỉ Nhân sự / Quản trị, theo luật chống leo thang (Nhân sự không sửa hồ sơ của Nhân sự / Quản trị khác).
 */
import { prisma } from "./db";
import { forbidden, notFound } from "./api";
import type { AuthUser } from "./auth";
import { canSeePersonal } from "./employees";
import { assertCanModify } from "./employee-guards";
import { getSettings } from "./settings";
import { todayVN } from "./attendance";
import { cmeStatus, licenseIssues } from "./credentials";

export async function loadCredentialTarget(u: AuthUser, employeeId: number, mode: "read" | "write") {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, code: true, name: true, role: true, active: true, departmentId: true, jobTitle: { select: { name: true, requiresLicense: true } } },
  });
  if (!e) throw notFound();
  if (mode === "read") {
    if (e.id !== u.id && !canSeePersonal(u)) throw forbidden("Chỉ Nhân sự, Quản trị và chính chủ xem được hồ sơ hành nghề");
    return e;
  }
  if (!canSeePersonal(u)) throw forbidden("Chỉ Nhân sự / Quản trị cập nhật hồ sơ hành nghề");
  // Không tự xác nhận hồ sơ hành nghề / CME của chính mình (trừ Quản trị) — như luật không tự duyệt đơn.
  if (e.id === u.id && u.role !== "ADMIN") throw forbidden("Không tự cập nhật hồ sơ hành nghề của chính mình — nhờ Nhân sự khác hoặc Quản trị");
  await assertCanModify(u, e, {});
  return e;
}

/** Toàn bộ hồ sơ hành nghề của một người + tiến độ CME + danh sách cảnh báo. */
export async function credentialProfile(employeeId: number, requiresLicense: boolean) {
  const [license, credentials, settings] = await Promise.all([
    prisma.practiceLicense.findUnique({ where: { employeeId } }),
    prisma.credential.findMany({ where: { employeeId }, orderBy: [{ type: "asc" }, { issuedAt: "desc" }, { id: "desc" }] }),
    getSettings(),
  ]);
  const today = todayVN();
  const cme = cmeStatus(license?.cmeCycleStart ?? null, credentials.filter((c) => c.type === "CME"), settings, today);
  const issues = licenseIssues({ requiresLicense, license, credentials, settings, today });
  return {
    license,
    credentials: credentials.map(({ fileKey, ...c }) => ({ ...c, hasFile: !!fileKey })),
    cme,
    issues,
    requiresLicense,
  };
}

export type CredentialAlert = { id: number; code: string; name: string; department: string; jobTitle: string | null; issues: ReturnType<typeof licenseIssues> };

/**
 * Quét mọi nhân viên đang làm có liên quan hành nghề (chức danh bắt buộc GPHN, hoặc đã có GPHN / chứng chỉ) → danh sách người có vấn đề.
 * Dùng cho thẻ dashboard (Nhân sự / Quản trị) và job `credential-check`.
 */
export async function credentialAlerts(now = new Date()): Promise<CredentialAlert[]> {
  const [emps, settings] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true, OR: [{ jobTitle: { requiresLicense: true } }, { license: { isNot: null } }, { credentials: { some: {} } }] },
      orderBy: [{ departmentId: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        department: { select: { name: true } },
        jobTitle: { select: { name: true, requiresLicense: true } },
        license: true,
        credentials: { select: { id: true, type: true, name: true, issuedAt: true, expiresAt: true, cmeHours: true } },
      },
    }),
    getSettings(),
  ]);
  const today = todayVN(now);
  const out: CredentialAlert[] = [];
  for (const e of emps) {
    const issues = licenseIssues({ requiresLicense: !!e.jobTitle?.requiresLicense, license: e.license, credentials: e.credentials, settings, today });
    if (issues.length) out.push({ id: e.id, code: e.code, name: e.name, department: e.department.name, jobTitle: e.jobTitle?.name ?? null, issues });
  }
  return out;
}
