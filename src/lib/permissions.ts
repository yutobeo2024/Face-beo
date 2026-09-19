/**
 * Ma trận phân quyền theo năng lực (capability), lưu trong DB (bảng RolePermission), chỉnh trên web.
 *
 * Ràng buộc KHÓA CỨNG (không nằm trong ma trận, không chỉnh được trên web):
 *  - ADMIN luôn có mọi quyền → không thể tự khóa mình ra ngoài.
 *  - Quyền `locked` chỉ thuộc ADMIN (cấu hình hệ thống, thiết bị, phân quyền, gán vai trò HR/ADMIN).
 *  - Phạm vi dữ liệu gắn theo vai trò (deptScope trong auth.ts), không theo ma trận.
 *  - Luật nghiệp vụ: không tự duyệt đơn của mình, nhân viên chỉ thấy dữ liệu của mình, chống leo thang vai trò.
 */
import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { forbidden, badRequest } from "./api";
import { requireUser, type AuthUser } from "./auth";
import type { Role } from "./roles";

export const CAPABILITIES = [
  { key: "dashboard.view", group: "Tổng quan", label: "Xem dashboard hôm nay" },
  { key: "roster.view", group: "Xếp ca", label: "Xem bảng xếp ca" },
  { key: "roster.edit", group: "Xếp ca", label: "Xếp ca / đăng ký ca tuần (tuần chưa khóa)" },
  { key: "roster.editRegistered", group: "Xếp ca", label: "Sửa ca đã đăng ký, sửa sau hạn (kèm lý do)" },
  { key: "requests.decide", group: "Đơn từ", label: "Duyệt / từ chối đơn (theo tuyến duyệt)" },
  { key: "attendance.view", group: "Chấm công", label: "Xem log chấm công" },
  { key: "attendance.executeCorrection", group: "Chấm công", label: "Chấm tay theo đơn bổ sung công đã duyệt" },
  { key: "attendance.manualDirect", group: "Chấm công", label: "Chấm tay trực tiếp (không cần đơn)" },
  { key: "attendance.delete", group: "Chấm công", label: "Xóa log chấm công" },
  { key: "snapshots.view", group: "Chấm công", label: "Xem ảnh snapshot" },
  { key: "suspicious.view", group: "Chấm công", label: "Xem lần quét đáng ngờ" },
  { key: "reports.view", group: "Báo cáo", label: "Xem bảng công, xuất Excel" },
  { key: "employees.view", group: "Nhân viên", label: "Xem danh sách nhân viên" },
  { key: "employees.manage", group: "Nhân viên", label: "Thêm / sửa / cho nghỉ việc, đặt lại mật khẩu" },
  { key: "faces.enroll", group: "Nhân viên", label: "Enroll / xóa khuôn mặt" },
  { key: "org.manage", group: "Tổ chức", label: "Phòng ban & quản lý, ngày lễ, định nghĩa ca, mẫu tuần" },
  { key: "settings.system", group: "Hệ thống", label: "Cấu hình hệ thống (ngưỡng, Zalo, lưu trữ)", locked: true },
  { key: "devices.manage", group: "Hệ thống", label: "Ghép / thu hồi thiết bị kiosk", locked: true },
  { key: "permissions.manage", group: "Hệ thống", label: "Sửa ma trận phân quyền", locked: true },
  { key: "roles.assignPrivileged", group: "Hệ thống", label: "Gán vai trò Nhân sự / Quản trị", locked: true },
] as const;

export type Capability = (typeof CAPABILITIES)[number]["key"];
export const EDITABLE_ROLES = ["HR", "MANAGER", "EMPLOYEE"] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

export const LOCKED_CAPS = new Set<string>(CAPABILITIES.filter((c) => "locked" in c && c.locked).map((c) => c.key));
const ALL_CAPS = new Set<string>(CAPABILITIES.map((c) => c.key));

/** Ma trận mặc định (dùng để seed và "Khôi phục mặc định"). */
export const DEFAULT_MATRIX: Record<EditableRole, Capability[]> = {
  HR: [
    "dashboard.view",
    "roster.view",
    "roster.edit",
    "roster.editRegistered",
    "requests.decide",
    "attendance.view",
    "attendance.executeCorrection",
    "snapshots.view",
    "reports.view",
    "employees.view",
    "employees.manage",
    "faces.enroll",
  ],
  MANAGER: ["dashboard.view", "roster.view", "roster.edit", "requests.decide", "attendance.view", "snapshots.view", "reports.view", "employees.view"],
  EMPLOYEE: [],
};

/** Quyền cho phép vào khu /admin. */
export const ADMIN_AREA_CAPS: Capability[] = [
  "dashboard.view",
  "roster.view",
  "requests.decide",
  "attendance.view",
  "attendance.executeCorrection",
  "reports.view",
  "employees.view",
  "employees.manage",
  "org.manage",
  "settings.system",
  "devices.manage",
  "permissions.manage",
];

// ---------------------------------------------------------------------------
// Nạp / cache
// ---------------------------------------------------------------------------

type Matrix = Record<EditableRole, Set<string>>;
const CACHE_MS = 60_000;
const g = globalThis as unknown as { __permCache?: { at: number; matrix: Matrix } | null; __permLoading?: Promise<Matrix> | null; __permGen?: number };

export function invalidatePermissionCache() {
  g.__permGen = (g.__permGen ?? 0) + 1;
  g.__permCache = null;
  g.__permLoading = null;
}

// Dòng đánh dấu "đã khởi tạo": nhờ đó Quản trị có thể bỏ hết quyền mà lần nạp sau không tự seed lại mặc định.
const SENTINEL = { role: "_meta", capability: "initialized" };

/** Nạp ma trận mặc định nếu chưa từng khởi tạo (idempotent). */
export async function ensureDefaultPermissions() {
  const inited = await prisma.rolePermission.findUnique({ where: { role_capability: SENTINEL } });
  if (inited) return false;
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({}),
    prisma.rolePermission.createMany({
      data: [SENTINEL, ...EDITABLE_ROLES.flatMap((role) => DEFAULT_MATRIX[role].map((capability) => ({ role, capability })))],
    }),
  ]);
  return true;
}

async function loadMatrix(): Promise<Matrix> {
  const gen = g.__permGen ?? 0;
  await ensureDefaultPermissions();
  const rows = await prisma.rolePermission.findMany();
  const m: Matrix = { HR: new Set(), MANAGER: new Set(), EMPLOYEE: new Set() };
  for (const r of rows) {
    // Bỏ qua mọi dữ liệu lạ trong DB: quyền không tồn tại hoặc quyền khóa cứng.
    if (r.role in m && ALL_CAPS.has(r.capability) && !LOCKED_CAPS.has(r.capability)) m[r.role as EditableRole].add(r.capability);
  }
  // Không ghi cache nếu ma trận vừa được lưu trong lúc đang nạp (tránh giữ quyền đã thu hồi).
  if ((g.__permGen ?? 0) === gen) g.__permCache = { at: Date.now(), matrix: m };
  return m;
}

export async function getMatrix(): Promise<Matrix> {
  if (g.__permCache && Date.now() - g.__permCache.at < CACHE_MS) return g.__permCache.matrix;
  if (!g.__permLoading) {
    const p = loadMatrix().finally(() => {
      if (g.__permLoading === p) g.__permLoading = null;
    });
    g.__permLoading = p;
  }
  return g.__permLoading;
}

export async function capabilitiesOf(role: Role | string): Promise<Set<string>> {
  if (role === "ADMIN") return new Set(ALL_CAPS);
  const m = await getMatrix();
  return new Set(m[role as EditableRole] ?? []);
}

export async function can(user: { role: Role | string }, cap: Capability): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (LOCKED_CAPS.has(cap)) return false;
  return (await capabilitiesOf(user.role)).has(cap);
}

export async function hasAdminAccess(user: { role: Role | string }): Promise<boolean> {
  const caps = await capabilitiesOf(user.role);
  return ADMIN_AREA_CAPS.some((c) => caps.has(c));
}

/** Đăng nhập + có quyền `cap` (bất kỳ trong danh sách nếu truyền mảng). */
export async function requirePerm(req: NextRequest, cap: Capability | Capability[]): Promise<AuthUser> {
  const u = await requireUser(req);
  const caps = Array.isArray(cap) ? cap : [cap];
  for (const c of caps) if (await can(u, c)) return u;
  throw forbidden();
}

export async function assertCan(user: AuthUser, cap: Capability) {
  if (!(await can(user, cap))) throw forbidden();
}

// ---------------------------------------------------------------------------
// Lưu ma trận (chỉ ADMIN — kiểm tra ở route)
// ---------------------------------------------------------------------------

export type MatrixInput = Partial<Record<string, string[]>>;

/** Kiểm tra và chuẩn hóa ma trận gửi lên. Từ chối hàng ADMIN, vai trò lạ, quyền lạ hoặc quyền khóa cứng. */
export function validateMatrix(input: MatrixInput): Record<EditableRole, string[]> {
  const out = { HR: [], MANAGER: [], EMPLOYEE: [] } as Record<EditableRole, string[]>;
  for (const role of EDITABLE_ROLES) {
    if (!(role in input)) throw badRequest(`Thiếu vai trò ${role} trong ma trận (phải gửi đủ các vai trò)`);
  }
  for (const [role, caps] of Object.entries(input)) {
    if (role === "ADMIN") throw badRequest("Không thể thay đổi quyền của Quản trị");
    if (!(EDITABLE_ROLES as readonly string[]).includes(role)) throw badRequest(`Vai trò không hợp lệ: ${role}`);
    for (const c of caps ?? []) {
      if (!ALL_CAPS.has(c)) throw badRequest(`Quyền không tồn tại: ${c}`);
      if (LOCKED_CAPS.has(c)) throw badRequest(`Quyền "${c}" chỉ dành cho Quản trị, không thể cấp`);
    }
    out[role as EditableRole] = [...new Set(caps ?? [])];
  }
  return out;
}

export async function saveMatrix(next: Record<EditableRole, string[]>) {
  invalidatePermissionCache();
  const before = await getMatrix();
  const diff: { role: string; added: string[]; removed: string[] }[] = [];
  for (const role of EDITABLE_ROLES) {
    const b = before[role];
    const a = new Set(next[role]);
    const added = [...a].filter((c) => !b.has(c));
    const removed = [...b].filter((c) => !a.has(c));
    if (added.length || removed.length) diff.push({ role, added, removed });
  }
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({}),
    prisma.rolePermission.createMany({ data: [SENTINEL, ...EDITABLE_ROLES.flatMap((role) => next[role].map((capability) => ({ role, capability })))] }),
  ]);
  invalidatePermissionCache();
  return diff;
}

export function capLabel(key: string) {
  return CAPABILITIES.find((c) => c.key === key)?.label ?? key;
}
