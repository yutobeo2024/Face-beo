import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { signSession } from "@/lib/session";
import { SESSION_COOKIE, KIOSK_COOKIE, FACE_MODEL_VERSION, type Role } from "@/lib/roles";
import { encryptDescriptor, randomToken, sha256 } from "@/lib/crypto";
import { invalidateFaceCache } from "@/lib/face-matcher";

export const BASE = "http://localhost:3000";

export async function sessionCookie(employeeId: number) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  // Test giả định người dùng đã đổi mật khẩu.
  if (e.mustChangePassword) await prisma.employee.update({ where: { id: e.id }, data: { mustChangePassword: false } });
  const token = await signSession({ sub: String(e.id), role: e.role as Role, name: e.name, mcp: false });
  return `${SESSION_COOKIE}=${token}`;
}

export function req(path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(path, BASE), {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export const ctx = <P extends Record<string, string | string[]>>(params: P = {} as P) => ({ params: Promise.resolve(params) });

export async function byCode(code: string) {
  return prisma.employee.findUniqueOrThrow({ where: { code }, include: { department: true } });
}

/** Vector embedding giả lập ổn định theo seed. */
export function fakeEmbedding(seed: number, dim = 1024): number[] {
  let s = seed * 9301 + 49297;
  return Array.from({ length: dim }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  });
}

export async function enrollFake(employeeId: number, seed: number) {
  await prisma.employee.update({ where: { id: employeeId }, data: { biometricConsentAt: new Date() } });
  await prisma.faceTemplate.deleteMany({ where: { employeeId } });
  const base = fakeEmbedding(seed);
  for (let i = 0; i < 5; i++) {
    const v = base.map((x, j) => x + (fakeEmbedding(seed * 10 + i)[j] * 0.05));
    await prisma.faceTemplate.create({ data: { employeeId, descriptor: encryptDescriptor(v), modelVersion: FACE_MODEL_VERSION, createdById: 1 } });
  }
  invalidateFaceCache();
  return base;
}

export async function pairedDevice(name = "Kiosk test") {
  const token = randomToken();
  const d = await prisma.kioskDevice.create({ data: { name, tokenHash: sha256(token), active: true } });
  return { device: d, cookie: `${KIOSK_COOKIE}=${token}`, token };
}

/** Đọc file Excel (exceljs) thành { SheetNames, rows(sheet) } — dòng 1 là tiêu đề, mỗi dòng sau là một object. */
export async function readXlsx(data: ArrayBuffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return {
    SheetNames: wb.worksheets.map((w) => w.name),
    rows<T = Record<string, unknown>>(name: string): T[] {
      const ws = wb.getWorksheet(name);
      if (!ws) return [];
      const header = (ws.getRow(1).values as unknown[]).map((v) => (v == null ? "" : String(v)));
      const out: T[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const o: Record<string, unknown> = {};
        (row.values as unknown[]).forEach((v, i) => {
          if (v != null && header[i]) o[header[i]] = v;
        });
        out.push(o as T);
      });
      return out;
    },
  };
}
