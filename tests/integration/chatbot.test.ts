// v1.17.0: Chat bot tra cứu y khoa — ai được dùng (theo phòng + từng người), khóa gọi, giới hạn, không lưu nội dung.
// KHÔNG gọi mạng thật: tiêm hàm fetch giả (__setChatbotTestHooks).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { todayVN } from "@/lib/attendance";
import { CHAT_PER_DAY, CHAT_PER_MINUTE, __setChatbotTestHooks, chatbotInfo, rewriteImagePaths } from "@/lib/chatbot";
import { byCode, ctx, req, sessionCookie } from "./helpers";

import * as askRoute from "@/app/api/me/chatbot/ask/route";
import * as imgRoute from "@/app/api/me/chatbot/static/[...path]/route";
import * as deptRoute from "@/app/api/departments/[id]/route";
import * as empRoute from "@/app/api/employees/[id]/route";

type E = Awaited<ReturnType<typeof byCode>>;
let admin: E, hr: E, emp: E, other: E;
let A: string, H: string, EMP: string, O: string;
type Call = { url: string; init: { headers?: Record<string, string>; body?: string } };
let calls: Call[] = [];
const reply: unknown = { reply_text: "Trả lời mẫu ![hình](/static/images/abc.png)", sources: [{ source_type: "guideline", title: "QT-01", image_url: "/static/images/abc.png" }] };
let status = 200;
let imageType = "image/png";

const ask = (cookie: string, body: unknown = { message: "Quy trình rửa tay thường quy?" }) =>
  askRoute.POST(req("/api/me/chatbot/ask", { method: "POST", cookie, body }), ctx());
const setDeptChatbot = (cookie: string, id: number, on: boolean) =>
  deptRoute.PATCH(req(`/api/departments/${id}`, { method: "PATCH", cookie, body: { chatbotEnabled: on } }), ctx({ id: String(id) }));
const setEmpChatbot = (cookie: string, id: number, v: boolean | null) =>
  empRoute.PATCH(req(`/api/employees/${id}`, { method: "PATCH", cookie, body: { chatbotEnabled: v } }), ctx({ id: String(id) }));

beforeAll(async () => {
  [admin, hr, emp, other] = await Promise.all(["NV001", "NV016", "NV008", "NV009"].map(byCode));
  [A, H, EMP, O] = await Promise.all([admin, hr, emp, other].map((e) => sessionCookie(e.id)));
  process.env.CHATBOT_API_URL = "http://backend:8089";
  process.env.CHATBOT_API_KEY = "khoa-test-123";
  __setChatbotTestHooks(async (url, init) => {
    calls.push({ url, init: init as Call["init"] });
    return {
      ok: status < 400,
      status,
      json: async () => reply,
      arrayBuffer: async () => new TextEncoder().encode("PNG-gia").buffer as ArrayBuffer,
      headers: { get: () => imageType },
    };
  });
});

afterEach(async () => {
  calls = [];
  status = 200;
  imageType = "image/png";
  await prisma.chatbotUsage.deleteMany({ where: { employeeId: { in: [admin.id, hr.id, emp.id, other.id] } } });
  await prisma.department.updateMany({ where: { id: { in: [emp.departmentId, other.departmentId] } }, data: { chatbotEnabled: false } });
  await prisma.employee.updateMany({ where: { id: { in: [admin.id, hr.id, emp.id, other.id] } }, data: { chatbotEnabled: null } });
});

afterAll(async () => {
  __setChatbotTestHooks(null);
  process.env.CHATBOT_API_URL = "";
  process.env.CHATBOT_API_KEY = "";
  await prisma.chatbotUsage.deleteMany({});
});

describe("ai được dùng chat bot", () => {
  it("chưa cấp cho phòng nào → 403 kèm lời nhắc liên hệ Nhân sự", async () => {
    const r = await ask(EMP);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("chưa được cấp quyền");
    expect(calls).toHaveLength(0); // không gọi sang chat bot
  });

  it("bật theo phòng → cả phòng dùng được; phòng khác vẫn không", async () => {
    expect((await setDeptChatbot(A, emp.departmentId, true)).status).toBe(200);
    expect((await ask(EMP)).status).toBe(200);
    expect((await ask(O)).status).toBe(403);
  });

  it("đặt riêng cho từng người thắng cấu hình phòng (cả cấp thêm lẫn cấm)", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    expect((await setEmpChatbot(A, emp.id, false)).status).toBe(200);
    expect((await ask(EMP)).status).toBe(403); // phòng bật nhưng người bị cấm
    expect((await setEmpChatbot(A, other.id, true)).status).toBe(200);
    expect((await ask(O)).status).toBe(200); // phòng tắt nhưng người được cấp riêng
    // Trả về "theo phòng" thì quay lại theo phòng.
    expect((await setEmpChatbot(A, emp.id, null)).status).toBe(200);
    expect((await ask(EMP)).status).toBe(200);
  });

  it("hàm quyết định (dùng cho menu) khớp với API", () => {
    expect(chatbotInfo({ chatbotEnabled: null, department: { chatbotEnabled: true } })).toEqual({ allowed: true, source: "DEPARTMENT" });
    expect(chatbotInfo({ chatbotEnabled: false, department: { chatbotEnabled: true } })).toEqual({ allowed: false, source: "EMPLOYEE" });
    expect(chatbotInfo({ chatbotEnabled: true, department: { chatbotEnabled: false } })).toEqual({ allowed: true, source: "EMPLOYEE" });
    expect(chatbotInfo({ chatbotEnabled: null, department: { chatbotEnabled: false } })).toEqual({ allowed: false, source: "DEPARTMENT" });
  });

  it("chỉ người có quyền mới cấp phát được", async () => {
    // Nhân viên thường: không đụng được cả phòng ban lẫn hồ sơ người khác.
    expect((await setDeptChatbot(EMP, emp.departmentId, true)).status).toBe(403);
    expect((await setEmpChatbot(EMP, other.id, true)).status).toBe(403);
    // Nhân sự: cấp cho TỪNG NGƯỜI được (có employees.manage + chatbot.grant), nhưng ô của cả PHÒNG nằm sau quyền
    // "Tổ chức" (mặc định chỉ Quản trị) nên vẫn bị chặn — đúng như ma trận phân quyền hiện hành.
    expect((await setEmpChatbot(H, emp.id, true)).status).toBe(200);
    expect((await setDeptChatbot(H, emp.departmentId, true)).status).toBe(403);
    expect((await setDeptChatbot(A, emp.departmentId, true)).status).toBe(200);
  });

  it("đổi cấp phát có ghi nhật ký và báo nhóm minh bạch", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    await setEmpChatbot(A, emp.id, false);
    expect(await prisma.auditLog.count({ where: { action: "CHATBOT_ACCESS", entity: "Department", entityId: String(emp.departmentId) } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "CHATBOT_ACCESS", entity: "Employee", entityId: String(emp.id) } })).toBeGreaterThan(0);
  });
});

describe("gọi sang chat bot", () => {
  it("gửi kèm vai trò + phòng ban (X-Chat-Viewer) để chat bot chỉ tìm trong tài liệu người hỏi được xem", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    await setEmpChatbot(A, hr.id, true);
    expect((await ask(EMP)).status).toBe(200);
    expect((await ask(H)).status).toBe(200);
    const [empDept, hrDept] = await Promise.all(
      [emp.departmentId, hr.departmentId].map((id) => prisma.department.findUniqueOrThrow({ where: { id }, select: { name: true } })),
    );
    const viewer = (c: Call) => JSON.parse(decodeURIComponent(c.init.headers?.["X-Chat-Viewer"] ?? ""));
    expect(viewer(calls[0])).toEqual({ role: emp.role, dept: empDept.name });
    expect(viewer(calls[1])).toEqual({ role: hr.role, dept: hrDept.name });
    // Header phải là ASCII (tên phòng tiếng Việt được mã hóa), nếu không fetch sẽ ném lỗi.
    expect(calls[0].init.headers?.["X-Chat-Viewer"]).toMatch(/^[ -~]+$/);
  });

  it("gửi kèm khóa X-Chat-Key, đổi đường ảnh sang Face Beo, không lộ khóa / địa chỉ nội bộ cho trình duyệt", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    const r = await ask(EMP);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://backend:8089/api/v1/chat");
    expect(calls[0].init.headers?.["X-Chat-Key"]).toBe("khoa-test-123");
    const body = await r.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("khoa-test-123");
    expect(raw).not.toContain("backend:8089");
    expect(body.reply_text).toContain("/api/me/chatbot/static/images/abc.png");
    expect(body.reply_text).not.toContain("](/static/images/");
  });

  it("chỉ gửi đi 10 lượt gần nhất của cuộc trò chuyện, không lưu nội dung ở máy chủ", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? ("ai" as const) : ("user" as const), content: `câu ${i}` }));
    const r = await ask(EMP, { message: "Câu hỏi bí mật về bệnh nhân X", history });
    expect(r.status).toBe(200);
    // Máy chủ chỉ giữ số đếm; không bảng nào chứa nội dung.
    const usage = await prisma.chatbotUsage.findMany({ where: { employeeId: emp.id } });
    expect(usage).toHaveLength(1);
    expect(JSON.stringify(usage)).not.toContain("bí mật");
    const logs = await prisma.auditLog.findMany({ where: { action: "CHATBOT_ACCESS" } });
    expect(JSON.stringify(logs)).not.toContain("bí mật");
  });

  it("chat bot lỗi / từ chối khóa → thông báo tiếng Việt, không lộ chi tiết nội bộ", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    status = 401;
    const r = await ask(EMP);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("khóa truy cập");
    status = 500;
    expect((await ask(EMP)).status).toBe(502);
  });

  it("câu hỏi rỗng → 400; quá 3 ảnh → 400", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    expect((await ask(EMP, { message: "   " })).status).toBe(400);
    const img = { data: "AAAA", mime_type: "image/png" };
    expect((await ask(EMP, { message: "xem giúp", attachments: [img, img, img, img] })).status).toBe(400);
    expect((await ask(EMP, { message: "xem giúp", attachments: [{ data: "AAAA", mime_type: "application/pdf" }] })).status).toBe(400);
  });
});

describe("giới hạn số lượt", () => {
  it("đếm lượt theo ngày và chặn khi vượt mức ngày", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    await ask(EMP);
    const row = await prisma.chatbotUsage.findUniqueOrThrow({ where: { employeeId_day: { employeeId: emp.id, day: todayVN() } } });
    expect(row.count).toBe(1);
    await prisma.chatbotUsage.update({ where: { employeeId_day: { employeeId: emp.id, day: todayVN() } }, data: { count: CHAT_PER_DAY } });
    const r = await ask(EMP);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toContain("hôm nay");
  });

  it(`quá ${CHAT_PER_MINUTE} câu/phút → 429 bằng tiếng Việt`, async () => {
    // Bộ đếm phút nằm trong bộ nhớ và tính theo người, các ca test trước có thể đã dùng vài lượt của O
    // → chỉ khẳng định: không quá mức cho phép, và cuối cùng phải bị chặn bằng tiếng Việt.
    await setDeptChatbot(A, other.departmentId, true);
    let ok = 0;
    let blocked: Response | null = null;
    for (let i = 0; i < CHAT_PER_MINUTE + 3 && !blocked; i++) {
      const r = await ask(O);
      if (r.status === 200) ok++;
      else blocked = r;
    }
    expect(ok).toBeLessThanOrEqual(CHAT_PER_MINUTE);
    expect(blocked?.status).toBe(429);
    expect((await blocked!.json()).error).toMatch(/hơi nhanh|hôm nay/);
  });
});

describe("ảnh minh họa lấy hộ", () => {
  const img = (cookie: string, path: string[]) => imgRoute.GET(req(`/api/me/chatbot/static/${path.join("/")}`, { cookie }), ctx({ path }));

  it("người được cấp quyền xem được, kèm cache riêng tư", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    const r = await img(EMP, ["images", "abc.png"]);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, max-age=600");
    expect(calls[0].url).toBe("http://backend:8089/static/images/abc.png");
  });

  it("chưa được cấp quyền → 403; đường dẫn lạ → 400", async () => {
    expect((await img(O, ["images", "abc.png"])).status).toBe(403);
    await setDeptChatbot(A, emp.departmentId, true);
    expect((await img(EMP, ["..", "..", "etc", "passwd"])).status).toBe(400);
    expect((await img(EMP, ["images", "a b.png"])).status).toBe(400);
  });

  it("chat bot trả về thứ không phải ảnh (SVG / trang HTML) → 502, không đưa xuống trình duyệt", async () => {
    await setDeptChatbot(A, emp.departmentId, true);
    for (const t of ["image/svg+xml", "text/html; charset=utf-8", ""]) {
      imageType = t;
      expect((await img(EMP, ["images", "abc.png"])).status).toBe(502);
    }
    imageType = "image/jpeg; charset=binary";
    const ok = await img(EMP, ["images", "abc.jpg"]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
  });

  it("đổi đường ảnh chỉ đụng ảnh của chat bot", () => {
    expect(rewriteImagePaths("![x](/static/images/a.png)")).toBe("![x](/api/me/chatbot/static/images/a.png)");
    expect(rewriteImagePaths("[link](https://example.com/static/images/a.png)")).toBe("[link](https://example.com/static/images/a.png)");
  });
});
