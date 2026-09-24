/**
 * QC v1.16.0 (giảm độ trễ) — các ca hiểm chưa có trong tests/integration/perf-v116.test.ts.
 * 1) `?fields=basic` phải TRÙNG TUYỆT ĐỐI với nhánh đầy đủ ở mọi bộ lọc (kể cả includeInactive, chức danh, chuyên khoa)
 *    — hai nhánh dùng chung biến `where`, nếu ai đó tách ra là test này đỏ.
 * 2) Bộ nhớ đệm ảnh (private, max-age + ETag) không được làm lộ ảnh cho người không có quyền, cũng không
 *    được tiếp tục trả ảnh đã xóa. Ảnh KHUÔN MẶT (dữ liệu sinh trắc) phải giữ ngắn hơn ảnh tự chọn.
 * 3) Chỉ mục mới thật sự được TRUY VẤN dùng (EXPLAIN QUERY PLAN); PRAGMA theo-kết-nối không được coi là toàn cục.
 * Mọi thay đổi dữ liệu trong file này đều được trả về nguyên trạng ở afterAll.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureDb, prisma } from "@/lib/db";
import { byCode, ctx, req, sessionCookie } from "./helpers";
import { clearFaceAvatar, saveFaceAvatar } from "@/lib/face-avatar";
import { clearProfilePhoto, saveProfilePhoto } from "@/lib/profile-photo";
import { invalidateFaceCache } from "@/lib/face-matcher";
import { encryptDescriptor } from "@/lib/crypto";
import { FACE_MODEL_VERSION } from "@/lib/roles";

import * as employeesRoute from "@/app/api/employees/route";
import * as avatarRoute from "@/app/api/employees/[id]/avatar/route";
import * as photoRoute from "@/app/api/employees/[id]/photo/route";

/** Thời gian giữ ảnh ở máy người dùng: ảnh tự chọn 10 phút; ảnh KHUÔN MẶT chỉ 1 phút (dữ liệu sinh trắc, mất quyền là hết thấy nhanh). */
const CACHE = { photo: "private, max-age=600", avatar: "private, max-age=60" } as const;
const maxAge = (v: string | null) => Number(/max-age=(\d+)/.exec(v ?? "")?.[1] ?? NaN);
const SAMPLE_JPEG = () => readFileSync(join(process.cwd(), "node_modules", "@vladmandic", "human", "assets", "samples.jpg"));
// 5 điểm mốc (mắt trái, mắt phải, mũi, khóe miệng trái / phải) nằm gọn trong ảnh mẫu 1280×1158.
const LANDMARKS: [number, number][] = [[560, 400], [620, 400], [590, 440], [565, 480], [615, 480]];

type Basic = { id: number; code: string; name: string; departmentId: number; active: boolean };

async function list(qs: string, cookie: string) {
  const r = await employeesRoute.GET(req(`/api/employees${qs}`, { cookie }), ctx());
  const body = (await r.json()) as { employees?: Basic[]; error?: string };
  return { status: r.status, employees: body.employees ?? [], error: body.error };
}
/** Danh sách id GIỮ NGUYÊN THỨ TỰ trả về — so cả nội dung lẫn thứ tự sắp xếp của hai nhánh. */
const idsOf = (rows: { id: number }[]) => rows.map((e) => e.id);

/** Gọi cùng một bộ lọc ở hai nhánh (rút gọn / đầy đủ) và đòi hai bên khớp nhau. */
async function bothBranches(filters: string, cookie: string) {
  const basic = await list(`?fields=basic${filters}`, cookie);
  const full = await list(`?${filters.replace(/^&/, "")}`, cookie);
  expect(basic.status, `basic ${filters}`).toBe(200);
  expect(full.status, `full ${filters}`).toBe(200);
  expect(idsOf(basic.employees), `thứ tự & nội dung khác nhau ở bộ lọc "${filters}"`).toEqual(idsOf(full.employees));
  return basic.employees;
}

// --- Dữ liệu mượn tạm, trả lại nguyên trạng ở afterAll ---
let admin: { id: number }, hr: { id: number }, mgr: { id: number; departmentId: number };
let outsider: { id: number; departmentId: number }; // nhân viên thường ở phòng khác — không được xem ảnh
let target: { id: number; departmentId: number; code: string }; // người có ảnh, thuộc phòng của mgr
let inactive: { id: number; code: string };
let jobTitleId: number, specialtyId: number;
const restore: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  await ensureDb();
  admin = await byCode("NV001"); // ADMIN
  hr = await byCode("NV016"); // HR — có employees.manage
  mgr = await byCode("NV003"); // MANAGER — có employees.view nhưng KHÔNG có employees.manage

  const inDept = await prisma.employee.findMany({ where: { departmentId: mgr.departmentId, role: "EMPLOYEE", active: true }, orderBy: { code: "asc" } });
  expect(inDept.length, "seed phải có ≥ 2 nhân viên thường trong phòng của NV003").toBeGreaterThanOrEqual(2);
  target = inDept[0];
  inactive = inDept[1];
  outsider = await prisma.employee.findFirstOrThrow({ where: { role: "EMPLOYEE", active: true, departmentId: { not: mgr.departmentId } } });

  // (a) một người "đã nghỉ việc" để thử includeInactive
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: inactive.id }, select: { active: true } });
  await prisma.employee.update({ where: { id: inactive.id }, data: { active: false } });
  restore.push(() => prisma.employee.update({ where: { id: inactive.id }, data: { active: before.active } }));

  // (b) gắn chức danh / chuyên khoa cho vài người để thử bộ lọc (seed để trống)
  const jt = await prisma.jobTitle.findFirstOrThrow({ orderBy: { id: "asc" } });
  const sp = await prisma.specialty.findFirstOrThrow({ orderBy: { id: "asc" } });
  jobTitleId = jt.id;
  specialtyId = sp.id;
  const tagged = await prisma.employee.findMany({ where: { active: true }, orderBy: { id: "asc" }, take: 6, select: { id: true, jobTitleId: true, specialtyId: true } });
  for (const e of tagged) {
    await prisma.employee.update({ where: { id: e.id }, data: { jobTitleId, specialtyId: e.id % 2 === 0 ? specialtyId : null } });
    restore.push(() => prisma.employee.update({ where: { id: e.id }, data: { jobTitleId: e.jobTitleId, specialtyId: e.specialtyId } }));
  }
  // người đã nghỉ cũng có chức danh: để bộ lọc chức danh + includeInactive có thứ để lệch nếu code sai
  const inact = await prisma.employee.findUniqueOrThrow({ where: { id: inactive.id }, select: { jobTitleId: true } });
  await prisma.employee.update({ where: { id: inactive.id }, data: { jobTitleId } });
  restore.push(() => prisma.employee.update({ where: { id: inactive.id }, data: { jobTitleId: inact.jobTitleId } }));

  // (c) ảnh tự chọn + ảnh khuôn mặt cho `target`
  const snap = await prisma.employee.findUniqueOrThrow({ where: { id: target.id }, select: { biometricConsentAt: true } });
  restore.push(async () => {
    await clearProfilePhoto(target.id);
    await clearFaceAvatar(target.id);
    await prisma.faceTemplate.deleteMany({ where: { employeeId: target.id } });
    await prisma.employee.update({ where: { id: target.id }, data: { biometricConsentAt: snap.biometricConsentAt } });
    invalidateFaceCache();
  });
  await saveProfilePhoto(target.id, new Uint8Array(SAMPLE_JPEG()));
  await prisma.employee.update({ where: { id: target.id }, data: { biometricConsentAt: new Date() } });
  await prisma.faceTemplate.create({ data: { employeeId: target.id, descriptor: encryptDescriptor(Array.from({ length: 512 }, (_, i) => i / 512 - 0.5)), modelVersion: FACE_MODEL_VERSION, createdById: admin.id } });
  invalidateFaceCache();
  await saveFaceAvatar(target.id, SAMPLE_JPEG(), LANDMARKS);
});

afterAll(async () => {
  for (const fn of restore.reverse()) await fn();
});

describe("QC — fields=basic phải khớp tuyệt đối nhánh đầy đủ", () => {
  it("includeInactive=1 (có employees.manage): người đã nghỉ XUẤT HIỆN ở cả hai nhánh", async () => {
    const cookie = await sessionCookie(hr.id);
    const withOut = await bothBranches("", cookie);
    const withIn = await bothBranches("&includeInactive=1", cookie);
    expect(idsOf(withOut), "không xin thì không được thấy người đã nghỉ").not.toContain(inactive.id);
    expect(idsOf(withIn), "HR xin includeInactive=1 thì phải thấy").toContain(inactive.id);
    expect(withIn.find((e) => e.id === inactive.id)!.active).toBe(false);
    // Phần CHÊNH giữa hai lần gọi phải TOÀN là người đã nghỉ, và phải có người mình vừa cho nghỉ.
    // (Không đòi đúng 1 người: chạy cả bộ test thì file khác cũng có thể để lại người đã nghỉ.)
    const extra = idsOf(withIn).filter((id) => !idsOf(withOut).includes(id));
    expect(extra, "thiếu người vừa cho nghỉ").toContain(inactive.id);
    const stillActive = withIn.filter((e) => extra.includes(e.id) && e.active);
    expect(stillActive.map((e) => e.code), "includeInactive=1 lôi thêm cả người đang làm").toEqual([]);
    // Ngược lại: bỏ includeInactive thì mọi người trả về đều đang làm việc.
    expect(withOut.filter((e) => !e.active).map((e) => e.code), "lọt người đã nghỉ khi không xin").toEqual([]);
  });

  it("includeInactive=1 KHÔNG có tác dụng với người chỉ có employees.view (Quản lý) — cả hai nhánh cùng im lặng bỏ qua", async () => {
    const cookie = await sessionCookie(mgr.id);
    const withOut = await bothBranches("", cookie);
    const withIn = await bothBranches("&includeInactive=1", cookie);
    expect(idsOf(withIn), "Quản lý không được thấy người đã nghỉ").not.toContain(inactive.id);
    expect(idsOf(withIn)).toEqual(idsOf(withOut));
    expect(withIn.every((e) => e.active), "danh sách của Quản lý chỉ gồm người đang làm").toBe(true);
    // Vẫn đúng phạm vi phòng.
    for (const e of withIn) expect(e.departmentId, `phòng ${e.departmentId}`).toBe(mgr.departmentId);
  });

  it("includeInactive=1 cho ADMIN: hai nhánh cùng một tập, và tập này đúng bằng DB", async () => {
    const cookie = await sessionCookie(admin.id);
    const rows = await bothBranches("&includeInactive=1", cookie);
    const all = await prisma.employee.findMany({ orderBy: [{ departmentId: "asc" }, { code: "asc" }], select: { id: true } });
    expect(idsOf(rows)).toEqual(idsOf(all));
  });

  it("lọc theo chức danh / chuyên khoa: hai nhánh khớp, kể cả khi ghép với phòng, tìm chữ và includeInactive", async () => {
    const cookieHr = await sessionCookie(hr.id);
    const cookieMgr = await sessionCookie(mgr.id);
    const combos = [
      `&jobTitleId=${jobTitleId}`,
      `&specialtyId=${specialtyId}`,
      `&jobTitleId=${jobTitleId}&specialtyId=${specialtyId}`,
      `&jobTitleId=${jobTitleId}&includeInactive=1`,
      `&jobTitleId=${jobTitleId}&departmentId=${mgr.departmentId}`,
      `&jobTitleId=${jobTitleId}&q=NV`,
      `&jobTitleId=999999`, // không ai khớp → cả hai nhánh cùng rỗng
    ];
    for (const c of combos) {
      const rowsHr = await bothBranches(c, cookieHr);
      if (c.includes("jobTitleId=999999")) expect(rowsHr, c).toHaveLength(0);
      await bothBranches(c, cookieMgr);
    }
    // Bộ lọc thật sự lọc (không phải "khớp vì cả hai cùng trả hết").
    const tagged = await list(`?fields=basic&jobTitleId=${jobTitleId}`, cookieHr);
    const allRows = await list("?fields=basic", cookieHr);
    expect(tagged.employees.length).toBeGreaterThan(0);
    expect(tagged.employees.length).toBeLessThan(allRows.employees.length);
    const dbIds = (await prisma.employee.findMany({ where: { jobTitleId, active: true }, orderBy: [{ departmentId: "asc" }, { code: "asc" }], select: { id: true } })).map((e) => e.id);
    expect(idsOf(tagged.employees)).toEqual(dbIds);
  });

  it("giá trị fields lạ bị từ chối 400 (zod enum), không âm thầm trả bản đầy đủ", async () => {
    const cookie = await sessionCookie(hr.id);
    for (const v of ["xxx", "BASIC", "basic,full", "", "full"]) {
      const r = await list(`?fields=${encodeURIComponent(v)}`, cookie);
      expect(r.status, `fields=${JSON.stringify(v)}`).toBe(400);
      expect(r.error, `fields=${JSON.stringify(v)}`).toMatch(/fields/);
    }
  });

  it("nhánh rút gọn không kèm bất kỳ khóa nào ngoài 5 khóa đã hứa (kể cả với ADMIN)", async () => {
    const r = await list("?fields=basic&includeInactive=1", await sessionCookie(admin.id));
    for (const e of r.employees) expect(Object.keys(e).sort()).toEqual(["active", "code", "departmentId", "id", "name"]);
  });
});

describe("QC — bộ nhớ đệm ảnh không làm lộ ảnh và không giữ ảnh đã xóa", () => {
  const params = (id: number) => ctx({ id: String(id) });

  for (const kind of ["photo", "avatar"] as const) {
    const route = () => (kind === "photo" ? photoRoute : avatarRoute);

    it(`${kind}: 200 kèm "${CACHE[kind]}" + ETag; If-None-Match khớp → 304 VẪN kèm đúng Cache-Control`, async () => {
      const cookie = await sessionCookie(target.id); // chính chủ
      const r = await route().GET(req(`/api/employees/${target.id}/${kind}`, { cookie }), params(target.id));
      expect(r.status, kind).toBe(200);
      expect(r.headers.get("cache-control"), kind).toBe(CACHE[kind]);
      expect(r.headers.get("content-type"), kind).toBe("image/jpeg");
      expect(r.headers.get("x-content-type-options"), kind).toBe("nosniff");
      const etag = r.headers.get("etag");
      expect(etag, kind).toMatch(/^"[0-9a-f-]{36}\.jpg"$/);
      expect((await r.arrayBuffer()).byteLength, kind).toBeGreaterThan(0);

      const r304 = await route().GET(req(`/api/employees/${target.id}/${kind}`, { cookie, headers: { "if-none-match": etag! } }), params(target.id));
      expect(r304.status, kind).toBe(304);
      expect(r304.headers.get("cache-control"), `304 ${kind} mất Cache-Control thì trình duyệt hỏi lại mỗi lần`).toBe(CACHE[kind]);
      expect(r304.headers.get("etag"), kind).toBe(etag);
      expect(await r304.text(), kind).toBe("");

      // ETag cũ / sai → phải trả lại ảnh đầy đủ, không trả 304 nhầm.
      const rStale = await route().GET(req(`/api/employees/${target.id}/${kind}`, { cookie, headers: { "if-none-match": '"00000000-0000-0000-0000-000000000000.jpg"' } }), params(target.id));
      expect(rStale.status, `${kind} ETag cũ`).toBe(200);
    });

    it(`${kind}: người không có quyền xem bị 403 và KHÔNG nhận header đệm nào`, async () => {
      const cookie = await sessionCookie(outsider.id); // nhân viên thường ở phòng khác
      const r = await route().GET(req(`/api/employees/${target.id}/${kind}`, { cookie }), params(target.id));
      expect(r.status, kind).toBe(403);
      expect(r.headers.get("cache-control"), `403 ${kind} không được kèm Cache-Control`).toBeNull();
      expect(r.headers.get("etag"), `403 ${kind} không được lộ ETag (khóa ảnh)`).toBeNull();
      const body = (await r.json()) as { error?: string };
      expect(typeof body.error).toBe("string");
    });

    it(`${kind}: chưa đăng nhập → 401, không header đệm`, async () => {
      const r = await route().GET(req(`/api/employees/${target.id}/${kind}`), params(target.id));
      expect(r.status, kind).toBe(401);
      expect(r.headers.get("cache-control"), kind).toBeNull();
    });
  }

  it("Quản lý phòng (có snapshots.view) vẫn xem được ảnh khuôn mặt của nhân viên phòng mình", async () => {
    const cookie = await sessionCookie(mgr.id);
    const r = await avatarRoute.GET(req(`/api/employees/${target.id}/avatar`, { cookie }), ctx({ id: String(target.id) }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe(CACHE.avatar);
  });

  it("ảnh khuôn mặt KHÔNG được giữ lâu bằng ảnh tự chọn (sinh trắc: thu hồi quyền phải hết hiện sớm hơn)", async () => {
    const cookie = await sessionCookie(target.id);
    const a = await avatarRoute.GET(req(`/api/employees/${target.id}/avatar`, { cookie }), ctx({ id: String(target.id) }));
    const p = await photoRoute.GET(req(`/api/employees/${target.id}/photo`, { cookie }), ctx({ id: String(target.id) }));
    const avatarAge = maxAge(a.headers.get("cache-control"));
    const photoAge = maxAge(p.headers.get("cache-control"));
    expect(avatarAge, "ảnh khuôn mặt phải có max-age hữu hạn").toBeGreaterThan(0);
    expect(avatarAge, `ảnh khuôn mặt ${avatarAge}s không được lâu hơn ảnh tự chọn ${photoAge}s`).toBeLessThanOrEqual(photoAge);
    expect(avatarAge, "dữ liệu sinh trắc không nên nằm trên máy người dùng quá 5 phút").toBeLessThanOrEqual(300);
    // private, không bao giờ public / shared cache (proxy, CDN).
    for (const [k, v] of [["avatar", a], ["photo", p]] as const) {
      expect(v.headers.get("cache-control"), k).toContain("private");
      expect(v.headers.get("cache-control"), k).not.toContain("public");
    }
  });

  it("xóa ảnh tự chọn xong thì URL trả 404 ngay — header đệm KHÔNG làm máy chủ tiếp tục phục vụ ảnh đã xóa", async () => {
    const cookie = await sessionCookie(target.id);
    const ok = await photoRoute.GET(req(`/api/employees/${target.id}/photo`, { cookie }), ctx({ id: String(target.id) }));
    expect(ok.status).toBe(200);
    const etag = ok.headers.get("etag")!;

    const del = await photoRoute.DELETE(req(`/api/employees/${target.id}/photo`, { method: "DELETE", cookie }), ctx({ id: String(target.id) }));
    expect(del.status).toBe(200);

    const gone = await photoRoute.GET(req(`/api/employees/${target.id}/photo`, { cookie }), ctx({ id: String(target.id) }));
    expect(gone.status, "ảnh đã xóa").toBe(404);
    expect(gone.headers.get("cache-control"), "404 không được kèm Cache-Control").toBeNull();
    // Kể cả khi trình duyệt còn cầm ETag cũ: không được trả 304 "ảnh cũ vẫn còn dùng được".
    const withEtag = await photoRoute.GET(req(`/api/employees/${target.id}/photo`, { cookie, headers: { "if-none-match": etag } }), ctx({ id: String(target.id) }));
    expect(withEtag.status, "ETag cũ sau khi xóa").toBe(404);

    // Ảnh khuôn mặt cũng vậy.
    await clearFaceAvatar(target.id);
    const noAvatar = await avatarRoute.GET(req(`/api/employees/${target.id}/avatar`, { cookie }), ctx({ id: String(target.id) }));
    expect(noAvatar.status).toBe(404);
    expect(noAvatar.headers.get("cache-control")).toBeNull();
  });
});

describe("QC — chỉ mục có thật trong DB và truy vấn dùng đúng chỉ mục", () => {
  const NEW_INDEXES: [string, string, string[]][] = [
    ["AuditLog_action_createdAt_idx", "AuditLog", ["action", "createdAt"]],
    ["Employee_active_departmentId_code_idx", "Employee", ["active", "departmentId", "code"]],
    ["Employee_role_active_idx", "Employee", ["role", "active"]],
    ["LeaveRequest_status_createdAt_idx", "LeaveRequest", ["status", "createdAt"]],
    ["LeaveRequest_type_status_executedAt_idx", "LeaveRequest", ["type", "status", "executedAt"]],
  ];

  it("đủ 5 chỉ mục mới, đúng bảng và đúng THỨ TỰ cột", async () => {
    const rows = (await prisma.$queryRawUnsafe("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'")) as { name: string; tbl_name: string; sql: string | null }[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const [name, table, cols] of NEW_INDEXES) {
      const row = byName.get(name);
      expect(row, `thiếu chỉ mục ${name}`).toBeTruthy();
      expect(row!.tbl_name, name).toBe(table);
      const inSql = (row!.sql ?? "").match(/\(([^)]*)\)/)?.[1] ?? "";
      expect(inSql.split(",").map((c) => c.trim().replace(/"/g, "")), `${name} sai thứ tự cột`).toEqual(cols);
    }
  });

  async function plan(sql: string) {
    const rows = (await prisma.$queryRawUnsafe(`EXPLAIN QUERY PLAN ${sql}`)) as { detail: string }[];
    return rows.map((r) => r.detail).join(" | ");
  }

  it("SQLite THẬT SỰ chọn AuditLog_action_createdAt_idx (không còn quét toàn bảng)", async () => {
    const detail = await plan("SELECT id, actorId, detail FROM AuditLog WHERE action = 'LOGIN' ORDER BY createdAt DESC LIMIT 20");
    expect(detail, `kế hoạch: ${detail}`).toContain("AuditLog_action_createdAt_idx");
    expect(detail, `vẫn quét toàn bảng: ${detail}`).not.toMatch(/SCAN AuditLog(?!_)/);
    // Chỉ mục ghép (action, createdAt) còn phải lo luôn phần ORDER BY — nếu không, SQLite phải sắp xếp tạm.
    expect(detail, `phải sắp xếp tạm: ${detail}`).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("các truy vấn hay dùng khác cũng bám chỉ mục mới", async () => {
    const cases: [string, string][] = [
      ["SELECT id, code FROM Employee WHERE active = 1 AND departmentId = 1 ORDER BY code", "Employee_active_departmentId_code_idx"],
      ["SELECT id FROM Employee WHERE role = 'MANAGER' AND active = 1", "Employee_role_active_idx"],
      ["SELECT id FROM LeaveRequest WHERE status = 'PENDING' ORDER BY createdAt DESC", "LeaveRequest_status_createdAt_idx"],
      ["SELECT id FROM LeaveRequest WHERE type = 'CORRECTION' AND status = 'APPROVED' AND executedAt IS NULL", "LeaveRequest_type_status_executedAt_idx"],
    ];
    for (const [sql, idx] of cases) {
      const detail = await plan(sql);
      expect(detail, `${idx} không được dùng — kế hoạch: ${detail}`).toContain(idx);
    }
  });
});

describe("QC — PRAGMA của SQLite sau ensureDb()", () => {
  const num = (rows: unknown, key: string) => Number((rows as Record<string, unknown>[])[0][key] as number | bigint);
  const one = async (p: string) => (await prisma.$queryRawUnsafe(`PRAGMA ${p}`)) as Record<string, unknown>[];
  /** Mã thật của db.ts, bỏ dòng chú thích — để đừng bắt nhầm chữ "synchronous" nằm trong lời giải thích. */
  const dbCode = () =>
    readFileSync(join(process.cwd(), "src", "lib", "db.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

  it("journal_mode = wal trên MỌI kết nối (WAL ghi vào file DB nên đi theo cả file, không theo kết nối)", async () => {
    await ensureDb();
    const modes = await Promise.all(Array.from({ length: 16 }, async () => String((await one("journal_mode"))[0].journal_mode).toLowerCase()));
    expect([...new Set(modes)], "WAL phải giống nhau ở mọi kết nối").toEqual(["wal"]);
  });

  it("gọi ensureDb() nhiều lần / song song không ném lỗi (nhớ 1 lần cho mỗi tiến trình)", async () => {
    await expect(Promise.all([ensureDb(), ensureDb(), ensureDb()])).resolves.toBeDefined();
    await ensureDb();
    expect(String((await one("journal_mode"))[0].journal_mode).toLowerCase()).toBe("wal");
  });

  /**
   * BÀI HỌC v1.16.0: `PRAGMA synchronous` (và busy_timeout, cache_size…) là cài đặt CỦA TỪNG KẾT NỐI.
   * Prisma mở nhiều kết nối tới SQLite, nên đặt một lần trong ensureDb() chỉ trúng đúng một kết nối —
   * các truy vấn sau rơi vào kết nối khác và vẫn là FULL. Muốn đổi thật thì phải ghim `?connection_limit=1`
   * trong DATABASE_URL (hoặc đặt lại ở mỗi kết nối). Test dưới đây khóa bài học đó lại.
   */
  it("db.ts KHÔNG được đặt PRAGMA synchronous khi chưa ghim connection_limit=1", () => {
    const code = dbCode();
    const setsSync = /PRAGMA\s+synchronous\s*=/i.test(code);
    const pinsOneConnection = /connection_limit=1/.test(code) || /connection_limit=1/.test(process.env.DATABASE_URL ?? "");
    expect(
      setsSync && !pinsOneConnection,
      "db.ts đặt PRAGMA synchronous nhưng Prisma dùng nhiều kết nối → cài đặt chỉ trúng 1 kết nối, không có tác dụng thật",
    ).toBe(false);
  });

  it("giá trị synchronous hiện tại đúng với những gì db.ts làm (2 = FULL mặc định; chỉ được là 1 khi đã ghim 1 kết nối)", async () => {
    await ensureDb();
    for (let i = 0; i < 20; i++) await prisma.employee.count(); // ép đi qua nhiều kết nối trong pool
    const sync = num(await one("synchronous"), "synchronous");
    expect([0, 1, 2, 3], `PRAGMA synchronous = ${sync}`).toContain(sync);
    if (sync !== 2) expect(dbCode(), "chỉ chấp nhận khác FULL khi DB đã ghim 1 kết nối").toMatch(/connection_limit=1/);
  });

  // Ghi nhận (không bắt buộc đỏ trên máy chỉ mở 1 kết nối): đặt PRAGMA ở một truy vấn rồi đọc lại ở các truy vấn sau.
  // Đo trên máy phát triển 24/09/2026: đặt synchronous=NORMAL xong, 20 truy vấn tiếp theo đều đọc ra 2 (FULL) —
  // đúng là rơi vào kết nối khác. Test này chỉ chặn giá trị LẠ (không phải giá trị nền, cũng không phải giá trị vừa đặt).
  it("giá trị PRAGMA theo từng kết nối: chỉ được là giá trị nền hoặc giá trị vừa đặt", async () => {
    await ensureDb();
    const base = num(await one("busy_timeout"), "timeout");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=12345;");
    const seen = new Set<number>();
    for (let i = 0; i < 24; i++) {
      await prisma.employee.count();
      seen.add(num(await one("busy_timeout"), "timeout"));
    }
    // Chỉ được phép là giá trị nền hoặc giá trị vừa đặt — nếu có cả hai thì đúng là nhiều kết nối (đó là lý do bỏ synchronous).
    for (const v of seen) expect([base, 12345], `busy_timeout lạ: ${v}`).toContain(v);
    await prisma.$queryRawUnsafe(`PRAGMA busy_timeout=${base};`); // trả lại như cũ trên kết nối đang cầm
  });
});
