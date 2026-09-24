/**
 * QC ĐỐI NGHỊCH cho v1.18.0 — Chat bot trả lời theo luồng (SSE).
 *
 * Mục tiêu: đánh vào chỗ dễ vỡ nhất của đường `/api/me/chatbot/ask/stream`:
 *  1) luồng bị CẮT VỤN (một sự kiện SSE về làm nhiều gói, cắt cả giữa ký tự tiếng Việt nhiều byte);
 *  2) hạn mức ngày / phút, giữ chỗ và hoàn lượt;
 *  3) quyền dùng (chưa đăng nhập, cookie kiosk, phiên bị thu hồi, phòng tắt, người bị cấm riêng);
 *  4) dữ liệu vào quá cỡ / sai kiểu;
 *  5) không lộ khóa `X-Chat-Key` lẫn địa chỉ nội bộ trong bất kỳ byte nào gửi về trình duyệt;
 *  6) không lưu nội dung câu hỏi vào BẤT KỲ bảng nào.
 *
 * KHÔNG gọi mạng thật: tiêm hàm fetch giả. Mọi dữ liệu tạo thêm đều dọn ở afterEach/afterAll.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { CHAT_PER_DAY, CHAT_PER_MINUTE, MAX_ATTACHMENTS, MAX_MESSAGE_CHARS, __setChatbotTestHooks, base64Chars, MAX_ATTACHMENT_TOTAL_BYTES, usageToday } from "@/lib/chatbot";
import { resetRateLimits } from "@/lib/rate-limit";
import { KIOSK_COOKIE } from "@/lib/roles";
import { BASE, byCode, ctx, pairedDevice, req, sessionCookie } from "./helpers";

import * as streamRoute from "@/app/api/me/chatbot/ask/stream/route";

const CHAT_URL = "http://chatbot-noi-bo:8089";
const CHAT_KEY = "khoa-bi-mat-QC-999";

type E = Awaited<ReturnType<typeof byCode>>;
let emp: E, other: E;
let EMP: string, O: string;

type Call = { url: string; init: { headers?: Record<string, string>; body?: string } };
let calls: Call[] = [];

// ---- Chat bot giả: điều khiển được từng GÓI byte trả về ----------------------------------------------------------
const enc = new TextEncoder();
/** Các gói byte mà chat bot "nhả" ra, theo đúng thứ tự (mỗi phần tử = một lần đọc được của route). */
let packets: Uint8Array[] = [];
/** Đứt kết nối sau khi nhả xong `errorAt` gói (null = không đứt). */
let errorAt: number | null = null;
/** Ép mã HTTP của chat bot (null = 200 kèm luồng). */
let upstreamStatus: number | null = null;
/** Gọi sang chat bot là ném lỗi mạng luôn. */
let throwOnFetch = false;

const sse = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const bytes = (s: string) => enc.encode(s);
/** Cắt vụn tối đa: mỗi byte một gói (dùng để cắt giữa ký tự tiếng Việt nhiều byte). */
const perByte = (s: string) => Array.from(enc.encode(s), (b) => new Uint8Array([b]));

function upstreamStream(): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (errorAt !== null && i >= errorAt) return void c.error(new Error("chat bot đứt kết nối"));
      if (i >= packets.length) return void c.close();
      c.enqueue(packets[i++]);
    },
  });
}

/** Đặt kịch bản luồng cho một lượt hỏi. */
function scenario(parts: (string | Uint8Array)[], opts: { errorAt?: number | null } = {}) {
  packets = parts.map((p) => (typeof p === "string" ? bytes(p) : p));
  errorAt = opts.errorAt ?? null;
}

// ---- Bộ đọc SSE y hệt trang chat (src/app/me/chatbot/page.tsx) ----------------------------------------------------
type Ev = { name: string; data: Record<string, unknown> | null };
/** Đọc luồng như trình duyệt: gom đệm, tách theo dòng trống. `data: null` = JSON hỏng, trang chat bỏ qua mẩu đó. */
async function readAsBrowser(res: Response): Promise<{ events: Ev[]; raw: string }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let buffer = "";
  const events: Ev[] = [];
  const flush = (part: string) => {
    const name = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim() ?? "";
    const rawData = /^data:\s*(.*)$/m.exec(part)?.[1] ?? "{}";
    try {
      events.push({ name, data: JSON.parse(rawData) as Record<string, unknown> });
    } catch {
      events.push({ name, data: null });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    buffer += dec.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const p of parts) if (p.trim()) flush(p);
  }
  if (buffer.trim()) flush(buffer);
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  return { events, raw };
}

/** Chữ mà trang chat ghép lại được (bỏ qua mẩu hỏng, đúng như code trang chat). */
const joined = (events: Ev[]) =>
  events.filter((e) => e.name === "chunk" && typeof e.data?.text === "string").map((e) => e.data!.text as string).join("");
const names = (events: Ev[]) => events.map((e) => e.name);

const askStream = (cookie: string | undefined, body: unknown = { message: "Rửa tay thường quy?" }) =>
  streamRoute.POST(req("/api/me/chatbot/ask/stream", { method: "POST", cookie, body }), ctx());

/** Đọc cạn luồng, nuốt lỗi (dùng cho các ca đứt giữa chừng). */
async function drain(res: Response) {
  try {
    await res.text();
  } catch {
    /* luồng đứt — đúng ý đồ của ca kiểm */
  }
}

beforeAll(async () => {
  [emp, other] = await Promise.all(["NV008", "NV009"].map(byCode));
  [EMP, O] = await Promise.all([emp, other].map((e) => sessionCookie(e.id)));
  process.env.CHATBOT_API_URL = CHAT_URL;
  process.env.CHATBOT_API_KEY = CHAT_KEY;
  __setChatbotTestHooks(async (url, init) => {
    calls.push({ url, init: init as Call["init"] });
    if (throwOnFetch) throw new Error(`ECONNREFUSED ${CHAT_URL} khóa=${CHAT_KEY}`); // lỗi có chứa bí mật: route không được để lọt
    const base = {
      ok: true,
      status: 200,
      json: async () => ({ reply_text: "Trả lời một lần", sources: [] }),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { get: () => "text/event-stream" },
    };
    if (upstreamStatus !== null) {
      return { ...base, ok: false, status: upstreamStatus, json: async () => ({ detail: `chat bot ${CHAT_URL} từ chối khóa ${CHAT_KEY}` }) };
    }
    if (url.endsWith("/chat/stream")) return { ...base, body: upstreamStream() };
    return { ...base, headers: { get: () => "application/json" } };
  });
});

beforeEach(async () => {
  await prisma.department.update({ where: { id: emp.departmentId }, data: { chatbotEnabled: true } });
  await prisma.employee.updateMany({ where: { id: { in: [emp.id, other.id] } }, data: { chatbotEnabled: null } });
  resetRateLimits();
  scenario([sse("sources", { sources: [] }), sse("chunk", { text: "ok" }), sse("done", {})]);
  upstreamStatus = null;
  throwOnFetch = false;
});

afterEach(async () => {
  calls = [];
  packets = [];
  errorAt = null;
  await prisma.chatbotUsage.deleteMany({ where: { employeeId: { in: [emp.id, other.id] } } });
  await prisma.department.updateMany({ where: { id: { in: [emp.departmentId, other.departmentId] } }, data: { chatbotEnabled: false } });
  await prisma.employee.updateMany({ where: { id: { in: [emp.id, other.id] } }, data: { chatbotEnabled: null } });
});

afterAll(async () => {
  __setChatbotTestHooks(null);
  delete process.env.CHATBOT_API_URL;
  delete process.env.CHATBOT_API_KEY;
  // Trả nguyên trạng cấu hình test (phòng khi ca kiểm cuối bỏ dở)
  await prisma.chatbotUsage.deleteMany({ where: { employeeId: { in: [emp.id, other.id] } } });
  await prisma.department.updateMany({ where: { id: { in: [emp.departmentId, other.departmentId] } }, data: { chatbotEnabled: false } });
  await prisma.employee.updateMany({ where: { id: { in: [emp.id, other.id] } }, data: { chatbotEnabled: null } });
});

// ===================================================================================================================
describe("1. Luồng bị cắt vụn", () => {
  const VN = "**Bước 1**: rửa tay thường quy — đủ 6 bước, mỗi bước 5 giây. Xem hình ![h](/static/images/a.png)";

  it("cắt giữa ký tự tiếng Việt nhiều byte (mỗi byte một gói) → ghép lại NGUYÊN VẸN", async () => {
    // Mẩu chữ đầu về trọn vẹn (mốc an toàn để route chèn sự kiện `used`), phần sau cắt tới từng byte.
    scenario([
      sse("sources", { sources: [] }),
      sse("chunk", { text: "Chào bạn, " }),
      ...perByte(sse("chunk", { text: VN }) + sse("done", {})),
    ]);
    const res = await askStream(EMP);
    expect(res.status).toBe(200);
    const { events } = await readAsBrowser(res);
    expect(joined(events)).toBe("Chào bạn, " + VN);
    expect(names(events)).toContain("used");
    expect(names(events).at(-1)).toBe("done");
    expect(await usageToday(emp.id)).toBe(1);
  });

  it("chunk bị cắt làm đôi giữa JSON vẫn phải ghép đủ chữ và có `used`", async () => {
    const text = sse("chunk", { text: "Rửa tay thường quy" });
    const cut = Math.floor(text.length / 2);
    scenario([sse("sources", { sources: [] }), text.slice(0, cut), text.slice(cut), sse("done", {})]);
    const { events } = await readAsBrowser(await askStream(EMP));
    expect(joined(events)).toBe("Rửa tay thường quy");
    expect(names(events)).toContain("used");
  });

  it("cắt giữa `event:` và `data:` vẫn ra đúng chữ", async () => {
    scenario([sse("sources", { sources: [] }), "event: chunk\n", 'data: {"text":"Xin chào"}\n\n', sse("done", {})]);
    const { events } = await readAsBrowser(await askStream(EMP));
    expect(joined(events)).toBe("Xin chào");
  });

  it("cắt giữa chữ `event: chunk` → không có sự kiện lỗi, vẫn trừ một lượt", async () => {
    scenario([sse("sources", { sources: [] }), "event: chu", 'nk\ndata: {"text":"Xin chào"}\n\n', sse("done", {})]);
    const { events } = await readAsBrowser(await askStream(EMP));
    expect(names(events)).not.toContain("error");
    expect(await usageToday(emp.id)).toBe(1);
  });

  it("chuỗi `event: chunk` nằm trong dữ liệu không được tính là đã có chữ", async () => {
    scenario([sse("sources", { sources: [{ source_type: "doc", title: "Mẫu log: event: chunk", image_url: "" }] })]);
    const { events } = await readAsBrowser(await askStream(EMP));
    expect(names(events)).toContain("error");
    expect(await usageToday(emp.id)).toBe(0);
  });
});

// ===================================================================================================================
describe("2. Hạn mức", () => {
  it("hỏi SONG SONG sát trần 100 câu/ngày → chỉ lọt đúng một câu, không vượt trần", async () => {
    await prisma.chatbotUsage.upsert({
      where: { employeeId_day: { employeeId: emp.id, day: todayVN() } },
      create: { employeeId: emp.id, day: todayVN(), count: CHAT_PER_DAY - 1 },
      update: { count: CHAT_PER_DAY - 1 },
    });
    const res = await Promise.all(Array.from({ length: 6 }, () => askStream(EMP)));
    await Promise.all(res.map(drain));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await usageToday(emp.id)).toBe(CHAT_PER_DAY);
    expect(calls).toHaveLength(1); // 5 câu bị chặn không được gọi sang chat bot
  });

  it("đứt giữa chừng SAU khi đã có chữ → giữ phần đã nhận, báo lỗi ở cuối, KHÔNG hoàn lượt", async () => {
    scenario([sse("sources", { sources: [] }), sse("chunk", { text: "Bước 1…" })], { errorAt: 2 });
    const { events } = await readAsBrowser(await askStream(EMP));
    expect(joined(events)).toBe("Bước 1…"); // chữ đã nhận không mất
    expect(names(events)).toContain("error"); // luồng đóng sạch kèm lời báo tiếng Việt, không đứt trần trụi
    expect(await usageToday(emp.id)).toBe(1); // đã tốn một lượt gọi chat bot
  });

  it("đứt TRƯỚC khi có chữ phải hoàn lượt", async () => {
    scenario([sse("sources", { sources: [] })], { errorAt: 1 });
    const res = await askStream(EMP);
    await drain(res);
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("chat bot ném lỗi mạng → 502, hoàn lượt, không lộ khóa trong thông báo", async () => {
    throwOnFetch = true;
    const res = await askStream(EMP);
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain(CHAT_KEY);
    expect(body).not.toContain("chatbot-noi-bo");
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("10 câu/phút: câu thứ 11 bị chặn 429 và KHÔNG tính vào hạn mức ngày", async () => {
    for (let i = 0; i < CHAT_PER_MINUTE; i++) {
      const r = await askStream(EMP);
      expect(r.status).toBe(200);
      await drain(r);
    }
    const res = await askStream(EMP);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("hỏi hơi nhanh");
    expect(await usageToday(emp.id)).toBe(CHAT_PER_MINUTE);
    expect(calls).toHaveLength(CHAT_PER_MINUTE);
  });
});

// ===================================================================================================================
describe("3. Quyền", () => {
  it("chưa đăng nhập → 401, không gọi sang chat bot", async () => {
    expect((await askStream(undefined)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("cookie kiosk (tablet chấm công) → 401", async () => {
    const { device, cookie } = await pairedDevice("QC kiosk chatbot");
    try {
      const res = await askStream(cookie);
      expect(res.status).toBe(401);
      expect(cookie.startsWith(`${KIOSK_COOKIE}=`)).toBe(true);
      expect(calls).toHaveLength(0);
    } finally {
      await prisma.kioskDevice.delete({ where: { id: device.id } });
    }
  });

  it("phiên bị thu hồi (đổi sessionVersion) → 401", async () => {
    const before = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.id }, select: { sessionVersion: true } })).sessionVersion;
    await prisma.employee.update({ where: { id: emp.id }, data: { sessionVersion: before + 1 } });
    try {
      expect((await askStream(EMP)).status).toBe(401);
      expect(calls).toHaveLength(0);
    } finally {
      await prisma.employee.update({ where: { id: emp.id }, data: { sessionVersion: before } });
    }
  });

  it("phòng tắt chat bot → 403, không tính lượt", async () => {
    await prisma.department.update({ where: { id: emp.departmentId }, data: { chatbotEnabled: false } });
    const res = await askStream(EMP);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(await usageToday(emp.id)).toBe(0);
  });

  it("người bị cấm riêng dù phòng đang bật → 403", async () => {
    await prisma.employee.update({ where: { id: emp.id }, data: { chatbotEnabled: false } });
    const res = await askStream(EMP);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("phòng tắt nhưng cho riêng một người → vẫn hỏi được", async () => {
    await prisma.department.update({ where: { id: other.departmentId }, data: { chatbotEnabled: false } });
    await prisma.employee.update({ where: { id: other.id }, data: { chatbotEnabled: true } });
    const res = await askStream(O);
    expect(res.status).toBe(200);
    await drain(res);
    expect(await usageToday(other.id)).toBe(1);
  });
});

// ===================================================================================================================
describe("4. Dữ liệu vào", () => {
  const tiny = { data: "QUJD", mime_type: "image/png" };

  it("câu hỏi quá dài → 400", async () => {
    const res = await askStream(EMP, { message: "a".repeat(MAX_MESSAGE_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("quá 3 ảnh → 400", async () => {
    const res = await askStream(EMP, { message: "x", attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => tiny) });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("tổng dung lượng ảnh quá lớn → 400", async () => {
    const half = Math.ceil(base64Chars(MAX_ATTACHMENT_TOTAL_BYTES) / 2) + 10;
    const res = await askStream(EMP, { message: "x", attachments: [{ data: "A".repeat(half), mime_type: "image/png" }, { data: "A".repeat(half), mime_type: "image/png" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Tổng dung lượng ảnh");
    expect(calls).toHaveLength(0);
  });

  it("history quá 10 lượt → 400", async () => {
    const history = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? "ai" : "user", content: "x" }));
    const res = await askStream(EMP, { message: "x", history });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("body không phải JSON → 400", async () => {
    const r = new NextRequest(new URL("/api/me/chatbot/ask/stream", BASE), {
      method: "POST",
      headers: { cookie: EMP, "content-type": "application/json" },
      body: "{khong-phai-json",
    });
    const res = await streamRoute.POST(r, ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("JSON");
    expect(calls).toHaveLength(0);
  });

  it("không có câu hỏi lẫn ảnh → 400, không tính lượt", async () => {
    const res = await askStream(EMP, { message: "   " });
    expect(res.status).toBe(400);
    expect(await usageToday(emp.id)).toBe(0);
  });
});

// ===================================================================================================================
describe("5. Không lộ bí mật", () => {
  const clean = (s: string) => {
    expect(s).not.toContain(CHAT_KEY);
    expect(s).not.toContain("chatbot-noi-bo");
    expect(s).not.toContain("8089");
    expect(s).not.toContain("X-Chat-Key");
  };

  it("luồng bình thường: không byte nào chứa khóa hay địa chỉ nội bộ", async () => {
    scenario([sse("sources", { sources: [] }), ...perByte(sse("chunk", { text: "nội dung" }) + sse("done", {}))]);
    const { raw } = await readAsBrowser(await askStream(EMP));
    clean(raw);
    // …nhưng khóa PHẢI được gửi sang chat bot
    expect(calls[0].init.headers?.["X-Chat-Key"]).toBe(CHAT_KEY);
    expect(calls[0].url.startsWith(CHAT_URL)).toBe(true);
  });

  it.each([401, 403, 422, 429, 500, 503])("chat bot trả %i → thông báo tiếng Việt, không lộ bí mật", async (status) => {
    upstreamStatus = status;
    const res = await askStream(EMP);
    expect(res.status).not.toBe(200);
    clean(await res.text());
    expect(await usageToday(emp.id)).toBe(0); // mọi lỗi trước khi có chữ đều hoàn lượt
  });

  it("chat bot ném lỗi mạng có chứa khóa trong message → không lọt ra ngoài", async () => {
    throwOnFetch = true;
    clean(await (await askStream(EMP)).text());
  });

  it("chat bot gửi sự kiện error → giữ thông báo của chat bot nhưng luồng vẫn sạch", async () => {
    scenario([sse("sources", { sources: [] }), sse("error", { detail: "Lỗi hệ thống khi xử lý câu hỏi." })]);
    const { events, raw } = await readAsBrowser(await askStream(EMP));
    expect(names(events)).toContain("error");
    clean(raw);
    expect(await usageToday(emp.id)).toBe(0);
  });
});

// ===================================================================================================================
describe("6. Không lưu nội dung hỏi đáp", () => {
  it("sau một lượt hỏi, KHÔNG bảng nào trong CSDL chứa câu hỏi", async () => {
    const secret = `qc-bi-mat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    scenario([sse("sources", { sources: [] }), sse("chunk", { text: `trả lời ${secret}` }), sse("done", {})]);
    const { events } = await readAsBrowser(await askStream(EMP, { message: secret, history: [{ role: "user", content: secret }] }));
    expect(names(events)).toContain("chunk");

    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    );
    const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
    for (const { name } of tables) {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${name}"`);
      expect(JSON.stringify(rows, replacer), `bảng ${name} lưu câu hỏi`).not.toContain(secret);
    }
    // Chỉ đếm lượt
    expect(await usageToday(emp.id)).toBe(1);
  });
});
