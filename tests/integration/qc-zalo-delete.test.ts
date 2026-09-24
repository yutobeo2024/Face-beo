/**
 * QC v1.15.0 — DELETE /api/settings/zalo/groups/[groupId] (gỡ nhóm khỏi danh sách nhận tin).
 * Các ca "hiền" đã nằm ở tests/integration/zalo-routing.test.ts; file này chỉ đi vào các ca hiểm:
 * vai trò khác, id cần mã hóa URL / id rất dài, xóa nhóm minh bạch DUY NHẤT, xóa hai lần cùng lúc,
 * nhóm có lọc phòng + nhiều loại tin, lịch sử tin cũ, thêm lại sau khi xóa, và rò rỉ bí mật.
 *
 * Nguyên tắc dọn dẹp: chỉ xóa hàng ZaloGroup do file này tạo (tiền tố `qcdel`), khôi phục nguyên trạng
 * loại tin / phòng của các nhóm có sẵn (nếu file test khác để lại).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { groupsFor } from "@/lib/zalo-routing";
import { sendZaloMessage, UNCONFIGURED_GROUP } from "@/lib/zalo-oa";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as groupRoute from "@/app/api/settings/zalo/groups/[groupId]/route";
import * as groupsRoute from "@/app/api/settings/zalo/groups/route";
import * as zaloStatusRoute from "@/app/api/settings/zalo/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, mgr: E, emp: E;
let A: string;

/** Mọi groupId do file này tạo — afterAll xóa sạch. */
const mine = new Set<string>();
/** Nguyên trạng các nhóm có sẵn (file test khác để lại) để khôi phục. */
let foreign: { groupId: string; categories: string; departmentIds: string }[] = [];

async function makeGroup(groupId: string, data: { name?: string; categories?: string[]; departmentIds?: number[] } = {}) {
  mine.add(groupId);
  await prisma.zaloGroup.deleteMany({ where: { groupId } });
  await prisma.zaloGroup.create({
    data: {
      groupId,
      name: data.name ?? null,
      source: "MANUAL",
      categories: JSON.stringify(data.categories ?? []),
      departmentIds: JSON.stringify(data.departmentIds ?? []),
    },
  });
  return groupId;
}

/**
 * Gọi route DELETE: URL mã hóa đúng như Next dựng, tham số động đã giải mã (Next giải mã trước khi vào handler).
 * `cookie = null` nghĩa là KHÔNG gửi cookie (không dùng `undefined` — tham số mặc định sẽ nhảy vào phiên Quản trị).
 */
const del = (groupId: string, cookie: string | null = A) =>
  groupRoute.DELETE(req(`/api/settings/zalo/groups/${encodeURIComponent(groupId)}`, { method: "DELETE", cookie: cookie ?? undefined }), ctx({ groupId }));

const exists = async (groupId: string) => (await prisma.zaloGroup.count({ where: { groupId } })) > 0;

/** Tắt tạm loại tin của các nhóm KHÔNG thuộc file này (khôi phục ở afterAll). */
async function muteForeignGroups() {
  const ids = foreign.map((g) => g.groupId);
  if (ids.length) await prisma.zaloGroup.updateMany({ where: { groupId: { in: ids } }, data: { categories: "[]" } });
}

beforeAll(async () => {
  [admin, hr, mgr, emp] = await Promise.all(["NV001", "NV016", "NV002", "NV007"].map(byCode));
  A = await sessionCookie(admin.id);
  foreign = await prisma.zaloGroup.findMany({ select: { groupId: true, categories: true, departmentIds: true } });
});

afterAll(async () => {
  await prisma.zaloGroup.deleteMany({ where: { groupId: { in: [...mine] } } });
  for (const g of foreign) {
    await prisma.zaloGroup.updateMany({ where: { groupId: g.groupId }, data: { categories: g.categories, departmentIds: g.departmentIds } });
  }
  await prisma.notificationLog.deleteMany({ where: { OR: [{ toGroupId: { in: [...mine] } }, { dedupeKey: { contains: "qcdel" } }] } });
  await prisma.auditLog.deleteMany({ where: { entity: "ZaloGroup", entityId: { in: [...mine] } } });
});

describe("DELETE nhóm Zalo — quyền", () => {
  it("chưa đăng nhập → 401; Quản lý → 403; Nhân viên → 403; HR → 403 — nhóm vẫn còn nguyên", async () => {
    const gid = await makeGroup("qcdel-quyen", { name: "Nhóm thử quyền", categories: ["CHAM_CONG"] });

    const anon = await del(gid, null);
    expect(anon.status).toBe(401);
    const asMgr = await del(gid, await sessionCookie(mgr.id));
    expect(asMgr.status, `vai trò ${mgr.role} phải bị từ chối`).toBe(403);
    const asEmp = await del(gid, await sessionCookie(emp.id));
    expect(asEmp.status, `vai trò ${emp.role} phải bị từ chối`).toBe(403);
    expect((await del(gid, await sessionCookie(hr.id))).status).toBe(403);

    expect(await exists(gid)).toBe(true);
    // Bị chặn thì KHÔNG được gửi tin chia tay vào nhóm (lộ thao tác + làm phiền nhóm).
    expect(await prisma.notificationLog.count({ where: { toGroupId: gid } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity: "ZaloGroup", entityId: gid } })).toBe(0);
  });
});

describe("DELETE nhóm Zalo — id khó", () => {
  it("id có dấu -, _ và ký tự phải mã hóa URL: route tra đúng hàng, không 500", async () => {
    const dash = await makeGroup("qcdel-a-b_c-D9", { categories: ["DON_TU"] });
    expect((await del(dash)).status).toBe(200);
    expect(await exists(dash)).toBe(false);

    // Ký tự phải mã hóa trong URL (dấu cách, /, %, +) — Next giải mã rồi mới đưa vào ctx.params.
    const weird = await makeGroup("qcdel x/y%2Bz+w", { name: "Nhóm id lạ", categories: ["CHAM_CONG"] });
    const res = await del(weird);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await res.json()).toEqual({ ok: true, groupId: weird });
    expect(await exists(weird)).toBe(false);
  });

  it("id rất dài: có thật → xóa được; không có thật → 404 (không 500)", async () => {
    const long = await makeGroup("qcdel-" + "x9".repeat(180), { categories: ["DON_TU"] });
    expect(long.length).toBeGreaterThan(300);
    expect((await del(long)).status).toBe(200);
    expect(await exists(long)).toBe(false);

    const ghost = "qcdel-khong-ton-tai-" + "z".repeat(2000);
    const miss = await del(ghost);
    expect(miss.status).toBe(404);
    expect((await miss.json()).error).toBeTruthy();
    // Chuỗi rỗng / chỉ khoảng trắng cũng không được làm sập máy chủ.
    expect((await del("   ")).status).toBe(404);
  });

  it("cột categories hỏng (không phải JSON) vẫn xóa được, không 500", async () => {
    const gid = "qcdel-json-hong";
    mine.add(gid);
    await prisma.zaloGroup.deleteMany({ where: { groupId: gid } });
    await prisma.zaloGroup.create({ data: { groupId: gid, source: "MANUAL", categories: "không-phải-json", departmentIds: "{" } });
    const res = await del(gid);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await exists(gid)).toBe(false);
  });
});

describe("DELETE nhóm Zalo — nhóm minh bạch duy nhất", () => {
  it("xóa chính nhóm MINH_BACH duy nhất: không ném lỗi, vẫn xóa, tin minh bạch vẫn được ghi nhật ký", async () => {
    await muteForeignGroups();
    const gid = await makeGroup("qcdel-minhbach-duynhat", { name: "Minh bạch duy nhất", categories: ["MINH_BACH"] });
    expect(await groupsFor("MINH_BACH")).toEqual([gid]);

    const res = await del(gid);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await exists(gid)).toBe(false);
    expect(await groupsFor("MINH_BACH")).toEqual([]);

    // Tin chia tay vào chính nhóm đó (gửi TRƯỚC khi xóa).
    expect(await prisma.notificationLog.count({ where: { toGroupId: gid, dedupeKey: { startsWith: `grp:zalo-disconnect:${gid}:` } } })).toBe(1);
    // Tin minh bạch: không còn nhóm nào nhận → ghi vào "chưa cấu hình" để Quản trị vẫn thấy trong Cấu hình → Zalo.
    const announced = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: `grp:zalo-delete:${gid}:` } } });
    expect(announced).toHaveLength(1);
    expect(announced[0].toGroupId).toBe(UNCONFIGURED_GROUP);
    expect(await prisma.auditLog.count({ where: { entity: "ZaloGroup", entityId: gid, detail: { contains: '"deleted":true' } } })).toBe(1);
  });
});

describe("DELETE nhóm Zalo — xóa hai lần cùng lúc", () => {
  it("hai yêu cầu song song: đúng một cái 200, cái còn lại 404 (không 500), hàng bị xóa hẳn", async () => {
    const gid = await makeGroup("qcdel-song-song", { name: "Nhóm xóa hai lần", categories: ["CHAM_CONG", "DON_TU"] });
    const settled = await Promise.allSettled([del(gid), del(gid)]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]); // handle() không được để lọt lỗi ra ngoài
    const codes = settled.map((s) => (s as PromiseFulfilledResult<Response>).value.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    // LỖI NGUỒN (v1.15.0): yêu cầu thua cuộc rơi vào `prisma.zaloGroup.delete` khi hàng đã biến mất
    // (route.ts:69 — P2025) → handle() trả 500 "Lỗi máy chủ" thay vì 404 "Không có nhóm này".
    // Người dùng bấm nút Xóa hai lần (hoặc hai Quản trị cùng lúc) sẽ thấy lỗi máy chủ dù việc xóa đã xong.
    // Cách sửa gợi ý: xóa bằng deleteMany rồi kiểm `count === 0 → notFound`, và gửi tin chia tay SAU khi xóa
    // được (tránh gửi hai tin "đã NGỪNG gửi tin" vào nhóm — hiện tại cả hai yêu cầu đều gửi).
    expect(codes, `mã trả về: ${codes.join(", ")}`).toEqual([200, 404]);
    expect(await exists(gid)).toBe(false);
  });

  it("xóa lần hai (tuần tự) → 404, không ghi thêm nhật ký hay tin chia tay", async () => {
    const gid = await makeGroup("qcdel-lan-hai", { categories: ["DON_TU"] });
    expect((await del(gid)).status).toBe(200);
    const audits = await prisma.auditLog.count({ where: { entity: "ZaloGroup", entityId: gid } });
    const notes = await prisma.notificationLog.count({ where: { toGroupId: gid } });
    expect((await del(gid)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { entity: "ZaloGroup", entityId: gid } })).toBe(audits);
    expect(await prisma.notificationLog.count({ where: { toGroupId: gid } })).toBe(notes);
  });
});

describe("DELETE nhóm Zalo — định tuyến sau khi xóa", () => {
  it("nhóm có lọc phòng + nhiều loại tin: mọi loại tin ngừng vào nhóm đó, nhóm khác vẫn nhận", async () => {
    await muteForeignGroups();
    const gone = await makeGroup("qcdel-nhieu-loai", { name: "Phòng của Lan", categories: ["CHAM_CONG", "DON_TU"], departmentIds: [emp.departmentId] });
    const keep = await makeGroup("qcdel-giu-lai", { name: "Nhóm giữ lại", categories: ["CHAM_CONG", "DON_TU"] });
    const mb = await makeGroup("qcdel-mb", { name: "Minh bạch", categories: ["MINH_BACH"] });

    for (const cat of ["CHAM_CONG", "DON_TU"] as const) {
      expect(await groupsFor(cat, emp.departmentId)).toEqual(expect.arrayContaining([gone, keep]));
    }
    expect((await del(gone)).status).toBe(200);
    for (const cat of ["CHAM_CONG", "DON_TU"] as const) {
      const after = await groupsFor(cat, emp.departmentId);
      expect(after).not.toContain(gone);
      expect(after).toContain(keep);
    }
    // Nhóm khác phòng cũng không bị ảnh hưởng, nhóm minh bạch vẫn nguyên.
    expect(await groupsFor("DON_TU", mgr.departmentId)).toContain(keep);
    expect(await groupsFor("MINH_BACH")).toContain(mb);
    expect(await exists(keep)).toBe(true);
  });

  it("lịch sử tin cũ giữ nguyên; GET /api/settings/zalo vẫn chạy (không 500) khi nhóm đã bị xóa", async () => {
    const gid = await makeGroup("qcdel-lich-su", { name: "Nhóm có lịch sử", categories: ["CHAM_CONG"] });
    const sent = await sendZaloMessage({
      toGroupId: gid,
      messageType: "GROUP_STAFF",
      dedupeKey: `staff:qcdel-lich-su:${Date.now()}@${gid}`,
      data: { icon: "⏰", employeeName: emp.name, employeeCode: emp.code, departmentName: "Phòng thử", text: "Chưa chấm giờ vào", atText: "08:30 01/01/2026" },
    });
    expect(sent.id).toBeTruthy();

    expect((await del(gid)).status).toBe(200);
    // Lịch sử là bất biến: bản ghi cũ còn nguyên dù nhóm đã bị gỡ.
    expect(await prisma.notificationLog.count({ where: { id: sent.id } })).toBe(1);

    const res = await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx());
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const body = (await res.json()) as { recent: { group: string; text: string }[] };
    // Không còn tên nhóm trong DB → hiện lại bằng chính ID nhóm, không được rơi vào undefined/500.
    const rows = body.recent.filter((r) => r.group === gid);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.group === "string" && r.group.length > 0)).toBe(true);
  });
});

describe("DELETE nhóm Zalo — sau khi xóa", () => {
  it("PATCH cùng id → 404; POST thêm lại → 200 và bắt đầu với danh sách loại tin rỗng", async () => {
    const gid = await makeGroup("qcdel-them-lai", { name: "Nhóm thêm lại", categories: ["CHAM_CONG", "DON_TU"], departmentIds: [emp.departmentId] });
    expect((await del(gid)).status).toBe(200);

    const patch = await groupRoute.PATCH(
      req(`/api/settings/zalo/groups/${gid}`, { method: "PATCH", cookie: A, body: { categories: ["DON_TU"] } }),
      ctx({ groupId: gid }),
    );
    expect(patch.status).toBe(404);
    expect(await exists(gid)).toBe(false);

    const add = await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: gid } }), ctx());
    expect(add.status, JSON.stringify(await add.clone().json())).toBe(200);
    const row = await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: gid } });
    // Thêm lại = tờ giấy trắng: không nhận tin, không còn lọc phòng cũ, không "hồi sinh" cấu hình đã xóa.
    expect(row.categories).toBe("[]");
    expect(row.departmentIds).toBe("[]");
    expect(await groupsFor("DON_TU", emp.departmentId)).not.toContain(gid);
  });
});

describe("DELETE nhóm Zalo — không rò rỉ bí mật", () => {
  it("thân phản hồi chỉ có { ok, groupId }; nhật ký chỉ ghi tên nhóm + loại tin", async () => {
    const gid = await makeGroup("qcdel-bi-mat", { name: "Nhóm bí mật", categories: ["MINH_BACH", "DON_TU"], departmentIds: [emp.departmentId] });
    const res = await del(gid);
    expect(res.status).toBe(200);
    const raw = await res.clone().text();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["groupId", "ok"]);
    expect(body).toEqual({ ok: true, groupId: gid });

    const secretish = /token|secret|refresh|password|cookie|session|BIOMETRIC|zalo_oa|appId/i;
    expect(raw).not.toMatch(secretish);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "ZaloGroup", entityId: gid }, orderBy: { id: "desc" } });
    expect(log.actorId).toBe(admin.id);
    const detail = JSON.parse(log.detail ?? "{}") as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual(["categories", "deleted", "groupName"]);
    expect(detail).toMatchObject({ deleted: true, groupName: "Nhóm bí mật", categories: ["MINH_BACH", "DON_TU"] });
    expect(log.detail ?? "").not.toMatch(secretish);
    // Không kèm dữ liệu cá nhân (SĐT/CCCD) của người thao tác vào nhật ký hay tin nhắn.
    const msgs = await prisma.notificationLog.findMany({ where: { dedupeKey: { contains: gid } } });
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m.payload).not.toMatch(secretish);
      if (admin.phone) expect(m.payload).not.toContain(admin.phone);
    }
  });
});
