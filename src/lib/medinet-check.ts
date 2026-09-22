/**
 * Đối chiếu GPHN đã lưu với medinet (v1.11.0): dùng cho nút "Tra cứu tự động" và job `medinet-check` (06:30, trước tin tổng hợp 07:30).
 * Kết quả lưu ở PracticeLicense.medinetResult (JSON) + medinetCheckedAt; vấn đề đi vào licenseIssues → dashboard + tin nhóm minh bạch.
 * Không tự sửa dữ liệu của Nhân sự: chỉ ghi "đã đối chiếu" khi khớp, còn khác nhau thì cảnh báo để người kiểm lại.
 */
import { prisma } from "./db";
import { audit } from "./audit";
import { getSettings, getStringSetting } from "./settings";
import { todayVN } from "./attendance";
import { compareMedinet, lookupMedinet, type MedinetRecord } from "./medinet";

export const clinicLicenses = async () =>
  (await getStringSetting("clinicFacilityLicenses"))
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export type StoredMedinetResult = {
  ok: boolean;
  found?: boolean;
  record?: MedinetRecord;
  diffs?: ReturnType<typeof compareMedinet>["diffs"];
  elsewhere?: ReturnType<typeof compareMedinet>["elsewhere"];
  atClinic?: boolean | null;
  candidates?: number;
  ambiguous?: boolean;
  error?: string;
  errorAt?: string;
};

/** Tra + so + lưu cho một nhân viên đã có GPHN. actorId null = hệ thống (job). */
export async function checkLicenseOnMedinet(employeeId: number, actorId: number | null, now = new Date()): Promise<StoredMedinetResult | null> {
  const lic = await prisma.practiceLicense.findUnique({ where: { employeeId }, include: { employee: { select: { name: true } } } });
  if (!lic) return null;
  const r = await lookupMedinet(lic.number, lic.employee.name);
  let prev: StoredMedinetResult | null = null;
  try {
    prev = lic.medinetResult ? JSON.parse(lic.medinetResult) : null;
  } catch {
    prev = null;
  }
  let result: StoredMedinetResult;
  let matched = false;
  if (!r.ok) {
    // Không tra được: giữ kết quả lần trước (không tạo / xóa cảnh báo vì lỗi mạng), chỉ ghi lỗi.
    result = { ...(prev ?? {}), ok: false, error: r.error, errorAt: now.toISOString() };
  } else if (!r.record && r.ambiguous) {
    // Nhiều người cùng số trên medinet, không phân định được: không kết luận, nhắc tra tay.
    result = { ok: true, found: false, ambiguous: true, candidates: r.candidates };
  } else if (!r.record) {
    result = { ok: true, found: false, candidates: r.candidates };
  } else {
    const cmp = compareMedinet(
      { employeeName: lic.employee.name, number: lic.number, issuedAt: lic.issuedAt, issuer: lic.issuer, subject: lic.subject, scope: lic.scope, status: lic.status },
      r.record,
      await clinicLicenses(),
      todayVN(now),
    );
    result = { ok: true, found: true, record: r.record, candidates: r.candidates, ...cmp };
    // Chỉ tự ghi "đã đối chiếu" khi medinet có đủ dữ liệu để so (không coi "trống" là khớp).
    matched = cmp.diffs.length === 0 && !!r.record.issuedAt && !!r.record.scope && r.record.status !== "UNKNOWN";
  }
  await prisma.practiceLicense.update({
    where: { employeeId },
    data: {
      // Tra lỗi: không dời mốc tra → job ngày mai thử lại (chỉ ghi lỗi vào kết quả).
      ...(r.ok ? { medinetCheckedAt: now } : {}),
      medinetResult: JSON.stringify(result),
      // Khớp hoàn toàn = coi như đã đối chiếu (verifiedById null khi do hệ thống tự làm).
      ...(matched ? { verifiedAt: now, verifiedById: actorId } : {}),
    },
  });
  await audit({
    actorId,
    action: "CREDENTIAL_UPDATE",
    entity: "PracticeLicense",
    entityId: employeeId,
    detail: { medinet: result.ok ? (result.found ? (matched ? "khớp" : `khác: ${result.diffs?.map((d) => d.field).join(",")}`) : "không tìm thấy") : "lỗi tra cứu" },
  });
  return result;
}

/**
 * Job hằng ngày: tra những GPHN của nhân viên đang làm chưa tra quá `medinetCheckDays` ngày (cũ nhất trước), tối đa `limit` người / lần
 * — tra tuần tự, cách nhau ≥ 4 giây (lookupMedinet tự giãn) để không làm phiền trang của Sở Y tế.
 */
export async function medinetCheck(now = new Date(), limit = 30) {
  const s = await getSettings();
  if (!s.medinetAutoCheck) return { skipped: "đã tắt tự tra cứu medinet" };
  const before = new Date(now.getTime() - s.medinetCheckDays * 86_400_000);
  const due = await prisma.practiceLicense.findMany({
    where: { employee: { active: true }, OR: [{ medinetCheckedAt: null }, { medinetCheckedAt: { lt: before } }] },
    orderBy: [{ medinetCheckedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    select: { employeeId: true },
  });
  let found = 0, notFound = 0, mismatched = 0, errors = 0, streak = 0, checked = 0;
  for (const d of due) {
    const r = await checkLicenseOnMedinet(d.employeeId, null, now);
    if (!r) continue;
    checked++;
    streak = r.ok ? 0 : streak + 1;
    if (!r.ok) errors++;
    else if (!r.found) notFound++;
    else {
      found++;
      if (r.diffs?.length || r.elsewhere?.length || r.atClinic === false) mismatched++;
    }
    if (streak >= 3) break; // 3 lỗi liên tiếp: medinet đang lỗi / chặn → dừng, mai thử lại
  }
  return { due: due.length, checked, found, notFound, mismatched, errors };
}

/**
 * Nhân sự vừa sửa GPHN: đổi số → bỏ kết quả medinet cũ (thuộc số khác); đổi trường khác → so lại với bản medinet đã lưu (không gọi mạng)
 * để cảnh báo không "treo" tới lần tra sau.
 */
export async function refreshStoredMedinet(employeeId: number, numberChanged: boolean) {
  const lic = await prisma.practiceLicense.findUnique({ where: { employeeId }, include: { employee: { select: { name: true } } } });
  if (!lic?.medinetResult) return;
  if (numberChanged) {
    await prisma.practiceLicense.update({ where: { employeeId }, data: { medinetResult: null, medinetCheckedAt: null } });
    return;
  }
  let prev: StoredMedinetResult;
  try {
    prev = JSON.parse(lic.medinetResult);
  } catch {
    return;
  }
  if (!prev.found || !prev.record) return;
  const cmp = compareMedinet(
    { employeeName: lic.employee.name, number: lic.number, issuedAt: lic.issuedAt, issuer: lic.issuer, subject: lic.subject, scope: lic.scope, status: lic.status },
    prev.record,
    await clinicLicenses(),
    todayVN(),
  );
  await prisma.practiceLicense.update({ where: { employeeId }, data: { medinetResult: JSON.stringify({ ...prev, ...cmp }) } });
}
