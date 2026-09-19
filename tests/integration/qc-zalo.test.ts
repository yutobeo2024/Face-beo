/**
 * QC v1.4 — Zalo OA chạy thật (GMF). Các lỗi QC tìm ra đã được sửa; test giữ lại làm hồi quy.
 */
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { __setZaloTestHooks, primeZaloToken } from "@/lib/zalo-token";
import { sendZaloMessage } from "@/lib/zalo-oa";
import { getStringSetting, saveStringSetting } from "@/lib/settings";
import { resetRateLimits } from "@/lib/rate-limit";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as settingsRoute from "@/app/api/settings/route";
import * as zaloStatusRoute from "@/app/api/settings/zalo/route";
import * as groupsRoute from "@/app/api/settings/zalo/groups/route";
import * as webhookRoute from "@/app/api/zalo/webhook/route";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let replies: { ok?: boolean; status?: number; body: unknown; nonJson?: boolean }[] = [];
function useFakeZalo() {
  __setZaloTestHooks({
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = replies.shift() ?? { body: { error: 0, message: "Success", data: { message_id: "m1" } } };
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        json: async () => {
          if (r.nonJson) throw new SyntaxError("Unexpected token <");
          return r.body;
        },
      };
    },
  });
}
const LIVE = { ZALO_OA_APP_ID: "123", ZALO_OA_SECRET: "sec", ZALO_WEBHOOK_SECRET: "wh" };
async function goLive() {
  Object.assign(process.env, LIVE);
  delete process.env.ZALO_OA_REFRESH_TOKEN;
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
const groupCalls = () => calls.filter((c) => c.url.includes("/oa/group/message"));
const send = (key = `qc:${randomUUID()}`) => sendZaloMessage({ toGroupId: "g-qc", messageType: "GROUP_EVENT", dedupeKey: key, data: { action: "qc" } });

let A: string;
beforeAll(async () => {
  A = await sessionCookie((await byCode("NV001")).id);
});
afterEach(async () => {
  calls = [];
  replies = [];
  resetRateLimits();
  await goSim();
  await saveStringSetting("zaloGroupId", "");
});

describe("(1) công tắc mô phỏng giữa các bản đóng gói (instrumentation vs route handler)", () => {
  it("bản module thứ hai (như bundle route handler — không được primeZaloToken) phải thấy chế độ thật khi DB có token, .env không còn refresh token", async () => {
    await goLive(); // bản module của test đã prime => thật
    vi.resetModules();
    const fresh = await import("@/lib/zalo-token"); // mô phỏng module id khác trong .next/server (route) — dbTokenKnown=false
    // Chỉ getAccessToken/refresh mới bật dbTokenKnown, nhưng chúng bị chặn phía sau isZaloSimulated() => kẹt mô phỏng vĩnh viễn.
    expect(fresh.isZaloSimulated()).toBe(false);
  });
});

describe("(2) phân loại mã lỗi Zalo", () => {
  it("-32 (vượt giới hạn request) => thử lại (đúng)", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ body: { error: -32, message: "rate" } }, { body: { error: 0 } }];
    expect((await send()).status).toBe("SENT");
    expect(groupCalls()).toHaveLength(2);
  });

  it("-201 (tham số không hợp lệ) không được thử lại — chỉ 1 lần gọi", async () => {
    await goLive();
    useFakeZalo();
    replies = [0, 1, 2].map(() => ({ body: { error: -201, message: "Parameters invalid" } }));
    expect((await send()).status).toBe("FAILED");
    expect(groupCalls()).toHaveLength(1);
  });

  it("-210 (tham số vượt quá giới hạn) không được thử lại — chỉ 1 lần gọi", async () => {
    await goLive();
    useFakeZalo();
    replies = [0, 1, 2].map(() => ({ body: { error: -210, message: "Param exceeds limit" } }));
    expect((await send()).status).toBe("FAILED");
    expect(groupCalls()).toHaveLength(1);
  });

  it("sau refresh, lỗi cấu hình (-213) từ lần gửi lại vẫn bị thử thêm (kiểm tra e thay vì e2)", async () => {
    await goLive();
    useFakeZalo();
    replies = [
      { body: { error: -216, message: "token" } },
      { body: { access_token: "at-2", refresh_token: "rt-2", expires_in: 90000 } },
      { body: { error: -213, message: "cfg" } },
      { body: { error: -213, message: "cfg" } },
      { body: { error: -213, message: "cfg" } },
    ];
    expect((await send()).status).toBe("FAILED");
    expect(groupCalls()).toHaveLength(2);
  });

  it("HTTP 200 nhưng thân không phải JSON (trang lỗi proxy/HTML) không được coi là SENT (thử lại 3 lần rồi FAILED)", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ nonJson: true, body: null }, { nonJson: true, body: null }, { nonJson: true, body: null }];
    expect((await send()).status).toBe("FAILED");
  });

  it("getoa dùng /v3.0/oa/getoa với header access_token", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ body: { error: 0, data: { oa_id: "1", name: "OA" } } }];
    await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx());
    const c = calls.find((x) => x.url.includes("/oa/getoa"))!;
    expect(c.url).toBe("https://openapi.zalo.me/v3.0/oa/getoa");
    expect((c.init.headers as Record<string, string>).access_token).toBe("at-1");
  });
});

describe("(4) webhook", () => {
  const sign = (raw: string, ts: string) => createHash("sha256").update("123" + raw + ts + "wh").digest("hex");
  const hook = (raw: string, sig: string | null, xff?: string) =>
    webhookRoute.POST(
      new NextRequest("http://localhost:3000/api/zalo/webhook", {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json", ...(sig ? { "x-zevent-signature": sig } : {}), ...(xff ? { "x-forwarded-for": xff } : {}) },
      }),
      ctx(),
    );

  it("chữ ký chấp nhận cả 'mac=<hex>' lẫn '<hex>', không phân biệt hoa thường; chữ ký sai vẫn 401", async () => {
    await goLive();
    const ts = String(Date.now());
    const raw = JSON.stringify({ event_name: "oa_send_text", app_id: "123", timestamp: ts });
    expect((await hook(raw, "mac=" + sign(raw, ts))).status).toBe(200);
    expect((await hook(raw, sign(raw, ts))).status).toBe(200);
    expect((await hook(raw, "mac=" + sign(raw, ts).toUpperCase())).status).toBe(200);
    expect((await hook(raw, "mac = " + sign(raw, ts))).status).toBe(200);
    expect((await hook(raw, sign(raw + "x", ts))).status).toBe(401);
  });

  it("rate limit theo IP cuối trong X-Forwarded-For (Cloudflare nối IP thật vào cuối) — IP khác không chung bucket", async () => {
    await goLive();
    const ts = String(Date.now());
    const raw = JSON.stringify({ event_name: "oa_send_text", app_id: "123", timestamp: ts });
    const sig = "mac=" + sign(raw, ts);
    for (let i = 0; i < 120; i++) await hook(raw, sig, "9.9.9.9, 1.1.1.1");
    expect((await hook(raw, sig, "8.8.8.8, 1.1.1.1")).status).toBe(429);
    expect((await hook(raw, sig, "2.2.2.2")).status).toBe(200);
  });

  it("create_group lặp lại (Zalo gửi lại) không tạo nhóm trùng", async () => {
    await goLive();
    useFakeZalo();
    const gid = `g-${randomUUID().slice(0, 8)}`;
    const ts = String(Date.now());
    const raw = JSON.stringify({ event_name: "create_group", oa_id: "1", group_id: gid, app_id: "123", timestamp: ts });
    replies = [{ body: { error: 0, data: { group_info: { name: "N", status: "enabled", total_member: 2 } } } }, { body: { error: 0, data: { group_info: { name: "N", status: "enabled", total_member: 2 } } } }];
    expect((await hook(raw, "mac=" + sign(raw, ts))).status).toBe(200);
    expect((await hook(raw, "mac=" + sign(raw, ts))).status).toBe(200);
    expect(await prisma.zaloGroup.count({ where: { groupId: gid } })).toBe(1);
    await prisma.zaloGroup.deleteMany({ where: { groupId: gid } });
  });
});

describe("(5) UI/API: lưu ngưỡng không được ghi đè nhóm đã kết nối", () => {
  it("PUT /api/settings (form ngưỡng gửi kèm zaloGroupId từ state) ghi đè nhóm đã kết nối/xác minh bằng giá trị cũ hoặc chưa xác minh", async () => {
    await goLive();
    useFakeZalo();
    replies = [{ body: { error: 0, data: { group_info: { name: "HR", status: "enabled", total_member: 3 } } } }];
    expect((await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: A, body: { groupId: "g-verified" } }), ctx())).status).toBe(200);
    // Tab khác còn state cũ (""), hoặc ô dán ID đang chứa ID gõ dở chưa xác minh => bấm "Lưu cấu hình" ở thẻ ngưỡng.
    const r = await settingsRoute.PUT(req("/api/settings", { method: "PUT", cookie: A, body: { zaloGroupId: "g-typo-unverified" } }), ctx());
    expect(r.status).toBe(200);
    expect(await getStringSetting("zaloGroupId")).toBe("g-verified");
    await prisma.zaloGroup.deleteMany({ where: { groupId: "g-verified" } });
  });
});

describe("(6) bảo mật", () => {
  it("GET /api/settings/zalo không lộ access/refresh token hay secret", async () => {
    await goLive();
    useFakeZalo();
    const txt = await (await zaloStatusRoute.GET(req("/api/settings/zalo", { cookie: A }), ctx())).text();
    for (const s of ["at-1", "rt-1", '"sec"', '"wh"']) expect(txt).not.toContain(s);
  });

  it("groups GET/POST yêu cầu settings.system (Quản lý => 403)", async () => {
    const mgr = await sessionCookie((await byCode("NV002")).id);
    expect((await groupsRoute.GET(req("/api/settings/zalo/groups", { cookie: mgr }), ctx())).status).toBe(403);
    expect((await groupsRoute.POST(req("/api/settings/zalo/groups", { method: "POST", cookie: mgr, body: { groupId: "gggg" } }), ctx())).status).toBe(403);
  });
});

describe("(7) không có vòng lặp khi gửi lỗi", () => {
  it("refresh token chết: mỗi tin chỉ gọi refresh 1 lần và không tự gửi thêm tin nhóm", async () => {
    await goLive();
    useFakeZalo();
    replies = [
      { body: { error: -216 } },
      { ok: false, status: 400, body: { error: -14014, message: "Invalid refresh token" } },
      { body: { error: -216 } },
      { body: { error: -216 } },
    ];
    expect((await send()).status).toBe("FAILED");
    expect(calls.filter((c) => c.url.includes("oauth.zaloapp.com"))).toHaveLength(1);
    expect(groupCalls().length).toBeLessThanOrEqual(3);
  });
});
