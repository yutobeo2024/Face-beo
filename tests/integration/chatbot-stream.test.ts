// v1.18.0: Chat bot trả lời THEO LUỒNG (SSE) — chữ hiện dần thay vì chờ Gemini viết xong cả câu.
// Kiểm: quyền dùng, khóa gửi đi, giới hạn ngày (giữ chỗ / hoàn lượt), chuyển tiếp luồng, quay về cách hỏi cũ khi
// chat bot chưa hỗ trợ luồng. KHÔNG gọi mạng thật: tiêm hàm fetch giả.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { CHAT_PER_DAY, __setChatbotTestHooks, usageToday } from "@/lib/chatbot";
import { resetRateLimits } from "@/lib/rate-limit";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as streamRoute from "@/app/api/me/chatbot/ask/stream/route";
import * as deptRoute from "@/app/api/departments/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, emp: E, other: E;
let A: string, EMP: string, O: string;
type Call = { url: string; init: { headers?: Record<string, string>; body?: string } };
let calls: Call[] = [];

/** Chat bot giả: "stream" trả luồng SSE, "nostream" = 404 (bản cũ), "boom" = 500, "empty" = luồng rỗng. */
type Mode = "stream" | "nostream" | "boom" | "empty" | "errorevent";
let mode: Mode = "stream";

const sse = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const CHUNKS = ["**Bước 1**: rửa tay. ", "Xem hình ![h](/static/images/a.png)"];

function fakeStream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

/** Đọc hết luồng trả về rồi tách thành danh sách [tên sự kiện, dữ liệu]. */
async function readEvents(res: Response): Promise<[string, Record<string, unknown>][]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((part) => {
      const name = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim() ?? "";
      const raw = /^data:\s*(.*)$/m.exec(part)?.[1] ?? "{}";
      return [name, JSON.parse(raw)] as [string, Record<string, unknown>];
    });
}

const askStream = (cookie: string | undefined, body: unknown = { message: "Rửa tay thường quy?" }) =>
  streamRoute.POST(req("/api/me/chatbot/ask/stream", { method: "POST", cookie, body }), ctx());
const setDeptChatbot = (cookie: string, id: number, on: boolean) =>
  deptRoute.PATCH(req(`/api/departments/${id}`, { method: "PATCH", cookie, body: { chatbotEnabled: on } }), ctx({ id: String(id) }));

beforeAll(async () => {
  [admin, emp, other] = await Promise.all(["NV001", "NV008", "NV009"].map(byCode));
  [A, EMP, O] = await Promise.all([admin, emp, other].map((e) => sessionCookie(e.id)));
  process.env.CHATBOT_API_URL = "http://backend:8089";
  process.env.CHATBOT_API_KEY = "khoa-test-123";
  __setChatbotTestHooks(async (url, init) => {
    calls.push({ url, init: init as Call["init"] });
    if (mode === "nostream" && url.endsWith("/chat/stream")) {
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    }
    if (mode === "boom") {
      return { ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    }
    if (url.endsWith("/chat/stream")) {
      const parts =
        mode === "empty"
          ? []
          : mode === "errorevent"
            ? [sse("sources", { sources: [] }), sse("error", { detail: "Lỗi hệ thống khi xử lý câu hỏi." })]
            : [sse("sources", { sources: [{ source_type: "guideline", title: "QT-01", image_url: "/static/images/a.png" }] }), ...CHUNKS.map((t) => sse("chunk", { text: t })), sse("done", {})];
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: { get: () => "text/event-stream" },
        body: fakeStream(parts),
      };
    }
    // Đường hỏi kiểu cũ (một lần)
    return {
      ok: true,
      status: 200,
      json: async () => ({ reply_text: "Trả lời một lần ![h](/static/images/a.png)", sources: [] }),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { get: () => "application/json" },
    };
  });
});

beforeEach(async () => {
  await prisma.department.update({ where: { id: emp.departmentId }, data: { chatbotEnabled: true } });
  resetRateLimits();
});

afterEach(async () => {
  calls = [];
  mode = "stream";
  await prisma.chatbotUsage.deleteMany({ where: { employeeId: { in: [admin.id, emp.id, other.id] } } });
  await prisma.department.updateMany({ where: { id: { in: [emp.departmentId, other.departmentId] } }, data: { chatbotEnabled: false } });
});

afterAll(() => {
  __setChatbotTestHooks(null);
  delete process.env.CHATBOT_API_URL;
  delete process.env.CHATBOT_API_KEY;
});

describe("hỏi chat bot theo luồng", () => {
  it("trả về luồng SSE: nguồn → số lượt → từng mẩu chữ → xong; gửi kèm khóa", async () => {
    const res = await askStream(EMP);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const events = await readEvents(res);
    const names = events.map(([n]) => n);
    // Thứ tự cố định: nguồn trước, số lượt ngay trước mẩu chữ đầu, "done" cuối cùng.
    expect(names[0]).toBe("sources");
    expect(names.indexOf("used")).toBeLessThan(names.indexOf("chunk"));
    expect(names.at(-1)).toBe("done");

    // Ghép các mẩu chữ lại đúng bằng câu trả lời gốc
    const text = events.filter(([n]) => n === "chunk").map(([, d]) => d.text as string).join("");
    expect(text).toBe(CHUNKS.join(""));

    const usedEvent = events.find(([n]) => n === "used")?.[1];
    expect(usedEvent).toEqual({ used: 1, limit: CHAT_PER_DAY });
    expect(calls[0].url).toBe("http://backend:8089/api/v1/chat/stream");
    expect(calls[0].init.headers?.["X-Chat-Key"]).toBe("khoa-test-123");
    expect(await usageToday(emp.id)).toBe(1);
  });

  it("số lượt chỉ gửi MỘT lần dù có nhiều mẩu chữ", async () => {
    const events = await readEvents(await askStream(EMP));
    expect(events.filter(([n]) => n === "used")).toHaveLength(1);
  });

  it("không lộ khóa hay địa chỉ nội bộ trong luồng gửi về trình duyệt", async () => {
    const res = await askStream(EMP);
    const body = await res.text();
    expect(body).not.toContain("khoa-test-123");
    expect(body).not.toContain("backend:8089");
  });

  it("chưa được cấp quyền → 403, không gọi sang chat bot, không tính lượt", async () => {
    const res = await askStream(O);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(await usageToday(other.id)).toBe(0);
  });

  it("chưa đăng nhập → 401", async () => {
    expect((await askStream(undefined)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("chat bot chưa có đường luồng (404) → tự quay về cách hỏi một lần, vẫn ra đủ sự kiện", async () => {
    mode = "nostream";
    const events = await readEvents(await askStream(EMP));
    const names = events.map(([n]) => n);
    expect(names).toEqual(["sources", "used", "chunk", "done"]);
    // Đường ảnh đã đổi sang Face Beo (nhánh hỏi một lần tự đổi sẵn)
    expect(events.find(([n]) => n === "chunk")?.[1].text).toContain("/api/me/chatbot/static/images/a.png");
    expect(calls.map((c) => c.url)).toEqual(["http://backend:8089/api/v1/chat/stream", "http://backend:8089/api/v1/chat"]);
    expect(await usageToday(emp.id)).toBe(1);
  });

  it("chat bot hỏng (500) → 502 tiếng Việt và HOÀN lượt", async () => {
    mode = "boom";
    const res = await askStream(EMP);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Chat bot");
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("luồng rỗng (chat bot chết giữa chừng chưa nói chữ nào) → báo lỗi trong luồng và HOÀN lượt", async () => {
    mode = "empty";
    const events = await readEvents(await askStream(EMP));
    expect(events.map(([n]) => n)).toContain("error");
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("chat bot gửi sự kiện lỗi trước khi có chữ → hoàn lượt, giữ nguyên thông báo của chat bot", async () => {
    mode = "errorevent";
    const events = await readEvents(await askStream(EMP));
    expect(events.map(([n]) => n)).toEqual(["sources", "error"]);
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("hết hạn mức ngày → 429, không gọi sang chat bot", async () => {
    await prisma.chatbotUsage.upsert({
      where: { employeeId_day: { employeeId: emp.id, day: todayVN() } },
      create: { employeeId: emp.id, day: todayVN(), count: CHAT_PER_DAY },
      update: { count: CHAT_PER_DAY },
    });
    const res = await askStream(EMP);
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(0);
    expect(await usageToday(emp.id)).toBe(CHAT_PER_DAY);
  });

  it("câu hỏi rỗng → 400; ảnh sai định dạng → 400", async () => {
    expect((await askStream(EMP, { message: "   " })).status).toBe(400);
    expect((await askStream(EMP, { message: "x", attachments: [{ data: "AAA", mime_type: "application/pdf" }] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("máy chủ không lưu nội dung câu hỏi (chỉ đếm lượt)", async () => {
    const secret = `bi-mat-${Date.now()}`;
    await readEvents(await askStream(EMP, { message: secret }));
    const logs = await prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 20, select: { detail: true } });
    expect(logs.some((l) => JSON.stringify(l.detail ?? "").includes(secret))).toBe(false);
    const rows = await prisma.chatbotUsage.findMany({ where: { employeeId: emp.id } });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("Quản trị cũng dùng được khi phòng của mình được bật", async () => {
    await setDeptChatbot(A, admin.departmentId, true);
    const events = await readEvents(await askStream(A));
    expect(events.map(([n]) => n)).toContain("chunk");
    await prisma.department.update({ where: { id: admin.departmentId }, data: { chatbotEnabled: false } });
  });
});
