// Đăng nhập một lần sang Dashboard CSKH (bot Zalo): vé ký HMAC phải khớp từng ký tự với bản chuẩn Python
// cskh_engine.dashboard.make_sso_ticket trong repo Zalo-hermess (hợp đồng giữa hai hệ thống).
import { describe, expect, it } from "vitest";
import { cskhSsoUrl, makeCskhTicket } from "@/lib/cskh-sso";

const SECRET = "test-secret-for-contract-0123456789ab";
// python -c "from cskh_engine.dashboard import make_sso_ticket; print(make_sso_ticket(SECRET, 'staff', 'nv001', now=1800000000, nonce='abcdef0123456789'))"
const PYTHON_TICKET = "djF8c3RhZmZ8MTgwMDAwMDAwMHxhYmNkZWYwMTIzNDU2Nzg5fG52MDAx.pKhEiD7H95J6PWpswM7oA5wj1zy5YQPr6clqtriiCHA";

describe("vé đăng nhập Dashboard CSKH", () => {
  it("khớp với bản chuẩn Python", () => {
    expect(makeCskhTicket(SECRET, "staff", "nv001", 1800000000, "abcdef0123456789")).toBe(PYTHON_TICKET);
  });

  it("mỗi vé có nonce riêng và giờ phát hành hiện tại", () => {
    const a = makeCskhTicket(SECRET, "admin", "beo");
    const b = makeCskhTicket(SECRET, "admin", "beo");
    expect(a).not.toBe(b);
    const payload = Buffer.from(a.split(".")[0], "base64url").toString("utf8").split("|");
    expect(payload[0]).toBe("v1");
    expect(payload[1]).toBe("admin");
    expect(Math.abs(Number(payload[2]) - Date.now() / 1000)).toBeLessThan(5);
    expect(payload[4]).toBe("beo");
  });

  it("đường dẫn tới dashboard", () => {
    expect(cskhSsoUrl("https://dashboard.example.vn/", "a.b")).toBe("https://dashboard.example.vn/dashboard/sso?t=a.b");
    expect(cskhSsoUrl("https://dashboard.example.vn", "a+b")).toBe("https://dashboard.example.vn/dashboard/sso?t=a%2Bb");
  });
});
