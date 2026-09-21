// Webhook khi chạy thật mà chưa có ZALO_WEBHOOK_SECRET: trả 200 để Zalo lưu được Webhook URL (Zalo chỉ cấp khóa sau bước này),
// nhưng tuyệt đối không xử lý sự kiện (không kiểm được chữ ký).
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ctx, req } from "./helpers";
import { GET, POST } from "@/app/api/zalo/webhook/route";

afterEach(() => vi.unstubAllEnvs());

describe("webhook chưa có khóa ký (production)", () => {
  it("POST trả 200 nhưng bỏ qua — không tạo nhóm; GET trả 200", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZALO_WEBHOOK_SECRET", "");
    const gid = `nosecret-${randomUUID().slice(0, 8)}`;
    const r = await POST(req("/api/zalo/webhook", { method: "POST", body: { event_name: "create_group", group_id: gid } }), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).ignored).toBe("no-webhook-secret");
    expect(await prisma.zaloGroup.findUnique({ where: { groupId: gid } })).toBeNull();
    expect(GET().status).toBe(200);
  });

  it("đã có khóa: request không ký vẫn bị từ chối 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZALO_WEBHOOK_SECRET", "secret-for-test");
    const r = await POST(req("/api/zalo/webhook", { method: "POST", body: { event_name: "create_group", group_id: "x", timestamp: 1 } }), ctx());
    expect(r.status).toBe(401);
  });
});
