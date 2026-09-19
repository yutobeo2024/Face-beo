/**
 * Zalo OA "chạy thật" nhưng giả lập HTTP bằng hook fetch: kiểm tra payload gửi nhóm đúng tài liệu,
 * phân loại lỗi (thử lại / không), công tắc mô phỏng, tin thử, chữ ký webhook.
 */
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { __setZaloTestHooks, isZaloSimulated, primeZaloToken } from "@/lib/zalo-token";
import { sendZaloMessage } from "@/lib/zalo-oa";
import { announce } from "@/lib/announce";
import { saveStringSetting } from "@/lib/settings";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as zaloStatusRoute from "@/app/api/settings/zalo/route";
import * as zaloTestRoute from "@/app/api/settings/zalo/test/route";
import * as webhookRoute from "@/app/api/zalo/webhook/route";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
/** Hook fetch: trả lời theo hàng đợi `replies` (mặc định thành công). */
let replies: { ok?: boolean; status?: number; body: unknown }[] = [];
function useFakeZalo() {
  __setZaloTestHooks({
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = replies.shift() ?? { body: { error: 0, message: "Success", data: { message_id: "m1" } } };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
    },
  });
}
const LIVE = { ZALO_OA_APP_ID: "123", ZALO_OA_SECRET: "sec", ZALO_WEBHOOK_SECRET: "wh" };
async function goLive() {
  Object.assign(process.env, LIVE);
  await prisma.zaloToken.deleteMany();
  await prisma.zaloToken.create({ data: { id: 1, accessToken: "at-1", refreshToken: "rt-1", expiresAt: new Date(Date.now() + 10 * 3600_000) } });
  await primeZaloToken();
}
async function goSim() {
  for (const k of Object.keys(LIVE)) delete process.env[k];
  delete process.env.ZALO_OA_REFRESH_TOKEN;
  await prisma.zaloToken.deleteMany();
  await primeZaloToken();
}

let admin: Awaited<ReturnType<typeof byCode>>;
let A: string;
beforeAll(async () => {
  admin = await byCode("NV001");
  A = await sessionCookie(admin.id);
});
afterEach(async () => {
  calls = [];
  replies = [];
  await goSim();
  await saveStringSetting("zaloGroupId", "");
});

describe("công tắc mô phỏng", () => {
  it("thiếu App ID/Secret hoặc không có token => mô phỏng; có App ID + Secret + token trong DB => thật (không cần token trong .env)", async () => {
    await goSim();
    expect(isZaloSimulated()).toBe(true);
    Object.assign(process.env, LIVE);
    expect(isZaloSimulated()).toBe(true); // chưa có token
    await goLive();
    expect(isZaloSimulated()).toBe(false);
    delete process.env.ZALO_WEBHOOK_SECRET; // webhook secret không ảnh hưởng
    expect(isZaloSimulated()).toBe(false);
  });
});

describe("gửi tin nhóm thật (fetch giả)", () => {
  it("payload đúng tài liệu GMF: POST /v3.0/oa/group/message, header access_token, {recipient:{group_id}, message:{text}} => SENT", async () => {
    await goLive();
    useFakeZalo();
    const r = await sendZaloMessage({ toGroupId: "g-abc", messageType: "GROUP_EVENT", dedupeKey: `t:${randomUUID()}`, data: { actorRole: "Quản trị", actorName: "A", action: "thử", atText: "" } });
    expect(r.status).toBe("SENT");
    const c = calls.find((x) => x.url.includes("/oa/group/message"))!;
    expect(c).toBeDefined();
    expect(c.init.method).toBe("POST");
    expect((c.init.headers as Record<string, string>).access_token).toBe("at-1");
    const body = JSON.parse(String(c.init.body));
    expect(body.recipient).toEqual({ group_id: "g-abc" });
    expect(typeof body.message.text).toBe("string");
    expect(body.message.text.length).toBeGreaterThan(5);
  });

  it("mã lỗi -213 (không thuộc nhóm tạm thời) => FAILED sau 1 lần gọi, ghi mã lỗi", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ body: { error: -213, message: "User not follow" } }];
    const key = `t:${randomUUID()}`;
    const r = await sendZaloMessage({ toGroupId: "g", messageType: "GROUP_EVENT", dedupeKey: key, data: { action: "x" } });
    expect(r.status).toBe("FAILED");
    expect(calls.filter((c) => c.url.includes("/group/message"))).toHaveLength(1);
    const row = await prisma.notificationLog.findUniqueOrThrow({ where: { dedupeKey: key } });
    expect(row.error).toContain("-213");
  });

  it("mã lỗi -32 (quá nhiều request) => thử lại, lần sau thành công => SENT", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ body: { error: -32, message: "Too many requests" } }, { body: { error: 0 } }];
    const r = await sendZaloMessage({ toGroupId: "g", messageType: "GROUP_EVENT", dedupeKey: `t:${randomUUID()}`, data: { action: "x" } });
    expect(r.status).toBe("SENT");
    expect(calls.filter((c) => c.url.includes("/group/message"))).toHaveLength(2);
  });

  it("token hết hạn (-216) => refresh rồi gửi lại thành công", async () => {
    await goLive();
    useFakeZalo();
    replies = [
      { body: { error: -216, message: "Access token invalid" } },
      { body: { access_token: "at-2", refresh_token: "rt-2", expires_in: 90000 } },
      { body: { error: 0 } },
    ];
    const r = await sendZaloMessage({ toGroupId: "g", messageType: "GROUP_EVENT", dedupeKey: `t:${randomUUID()}`, data: { action: "x" } });
    expect(r.status).toBe("SENT");
    expect(calls.some((c) => c.url.includes("oauth.zaloapp.com/v4/oa/access_token"))).toBe(true);
    const last = calls.filter((c) => c.url.includes("/group/message")).at(-1)!;
    expect((last.init.headers as Record<string, string>).access_token).toBe("at-2");
    expect((await prisma.zaloToken.findUniqueOrThrow({ where: { id: 1 } })).refreshToken).toBe("rt-2");
  });

  it("chế độ thật nhưng chưa cấu hình ID nhóm => announce ghi FAILED có lý do (không im lặng)", async () => {
    await goLive();
    useFakeZalo();
    const key = `noid:${randomUUID()}`;
    await announce({ id: admin.id, name: admin.name, role: "ADMIN" }, "thử", { key, always: true });
    const row = await prisma.notificationLog.findUniqueOrThrow({ where: { dedupeKey: `grp:${key}` } });
    expect(row.status).toBe("FAILED");
    expect(row.error).toContain("Chưa cấu hình");
    expect(calls).toHaveLength(0);
  });
});

describe("API trạng thái & gửi thử (Quản trị)", () => {
  it("mô phỏng: trạng thái simulated=true, gửi thử => SIMULATED; Quản lý => 403", async () => {
    const st = await (await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx())).json();
    expect(st.simulated).toBe(true);
    expect(st.token.exists).toBe(false);
    const t = await (await zaloTestRoute.POST(req("/api/settings/zalo/test", { method: "POST", cookie: A }), ctx())).json();
    expect(t.status).toBe("SIMULATED");
    const mgr = await sessionCookie((await byCode("NV002")).id);
    expect((await zaloTestRoute.POST(req("/api/settings/zalo/test", { method: "POST", cookie: mgr }), ctx())).status).toBe(403);
  });

  it("thật: trạng thái gọi getoa + getgroup, gửi thử => SENT với payload nhóm đúng", async () => {
    await goLive();
    await saveStringSetting("zaloGroupId", "g-live");
    useFakeZalo();
    replies = [{ body: { error: 0, data: { oa_id: "99", name: "Face Beo OA" } } }, { body: { error: 0, data: { group_info: { name: "Nhóm HR", status: "enabled", total_member: 4, group_link: "https://zalo.me/g/x" } } } }];
    const st = await (await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx())).json();
    expect(st.simulated).toBe(false);
    expect(st.oa.name).toBe("Face Beo OA");
    expect(st.group).toMatchObject({ name: "Nhóm HR", status: "enabled", totalMember: 4 });
    expect(calls.find((c) => c.url.includes("/group/getgroup?group_id=g-live"))).toBeDefined();
    calls = [];
    const t = await (await zaloTestRoute.POST(req("/api/settings/zalo/test", { method: "POST", cookie: A }), ctx())).json();
    expect(t.status).toBe("SENT");
    expect(JSON.parse(String(calls[0].init.body)).recipient.group_id).toBe("g-live");
    const st2 = await (await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx())).json();
    expect(st2.recent[0].status).toBe("SENT");
  });
});

describe("webhook", () => {
  const sign = (raw: string, ts: string) => "mac=" + createHash("sha256").update("123" + raw + ts + "wh").digest("hex");
  const post = (raw: string, sig: string | null) =>
    webhookRoute.POST(
      new NextRequest("http://localhost:3000/api/zalo/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", ...(sig ? { "x-zevent-signature": sig } : {}) } }),
      ctx(),
    );
  it("chữ ký đúng => 200; sai => 401/403; sự kiện khác user_send_text bị bỏ qua", async () => {
    await goLive();
    const ts = String(Date.now());
    const raw = JSON.stringify({ event_name: "oa_send_text", app_id: "123", sender: { id: "oa" }, recipient: { id: "u1" }, message: { text: "hi" }, timestamp: ts });
    const ok = await post(raw, sign(raw, ts));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ignored).toBe(true);
    const bad = await post(raw, "mac=deadbeef");
    expect([401, 403]).toContain(bad.status);
    const none = await post(raw, null);
    expect([401, 403]).toContain(none.status);
  });
});

describe("dò & kết nối nhóm GMF", () => {
  const signW = (raw: string, ts: string) => "mac=" + createHash("sha256").update("123" + raw + ts + "wh").digest("hex");
  const hook = (raw: string, sig: string) =>
    webhookRoute.POST(new NextRequest("http://localhost:3000/api/zalo/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-zevent-signature": sig } }), ctx());
  it("webhook create_group (có chữ ký) => nhóm xuất hiện trong danh sách, lấy tên qua getgroup", async () => {
    await goLive();
    useFakeZalo();
    const gid = `g-${randomUUID().slice(0, 8)}`;
    replies = [{ body: { error: 0, data: { group_info: { name: "Nhóm minh bạch", status: "enabled", total_member: 3 } } } }];
    const ts = String(Date.now());
    const raw = JSON.stringify({ event_name: "create_group", oa_id: "2057", group_id: gid, app_id: "123", timestamp: ts });
    expect((await hook(raw, signW(raw, ts))).status).toBe(200);
    const g = await prisma.zaloGroup.findUniqueOrThrow({ where: { groupId: gid } });
    expect(g).toMatchObject({ source: "WEBHOOK", name: "Nhóm minh bạch", status: "enabled", oaId: "2057" });
    // Sai chữ ký => không lưu
    const gid2 = `g-${randomUUID().slice(0, 8)}`;
    const raw2 = JSON.stringify({ event_name: "create_group", group_id: gid2, app_id: "123", timestamp: ts });
    expect([401, 403]).toContain((await hook(raw2, "mac=bad")).status);
    expect(await prisma.zaloGroup.count({ where: { groupId: gid2 } })).toBe(0);
    await prisma.zaloGroup.deleteMany({ where: { groupId: gid } });
  });

  it("Kết nối nhóm: thật => xác minh getgroup (disabled => 400), enabled => lưu zaloGroupId + tin xác nhận vào nhóm; Quản lý => 403", async () => {
    await goLive();
    useFakeZalo();
    const { POST, GET } = await import("@/app/api/settings/zalo/groups/route");
    replies = [{ body: { error: 0, data: { group_info: { name: "Nhóm cũ", status: "disabled" } } } }];
    expect((await POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: "g-off" } }), ctx())).status).toBe(400);
    replies = [{ body: { error: 0, data: { group_info: { name: "Nhóm HR", status: "enabled", total_member: 5 } } } }];
    const ok = await POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: "g-on" } }), ctx());
    expect(ok.status).toBe(200);
    const send = calls.filter((c) => c.url.includes("/group/message")).at(-1)!;
    expect(JSON.parse(String(send.init.body)).recipient.group_id).toBe("g-on");
    replies = [{ body: { error: 0, data: { group_info: { name: "Nhóm HR", status: "enabled", total_member: 5 } } } }];
    const list = await (await GET(req("/api/settings/zalo/groups", { cookie: A }), ctx())).json();
    expect(list.connected).toBe("g-on");
    expect(list.groups.find((g: { groupId: string }) => g.groupId === "g-on")).toMatchObject({ name: "Nhóm HR", source: "MANUAL" });
    const mgr = await sessionCookie((await byCode("NV002")).id);
    expect((await POST(req("/api/settings/zalo/groups", { method: "POST", cookie: mgr, body: { groupId: "g-on" } }), ctx())).status).toBe(403);
    await prisma.zaloGroup.deleteMany({ where: { groupId: { in: ["g-on", "g-off"] } } });
  });
});
