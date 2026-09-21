// IP người dùng thật cho giới hạn tần suất: sau reverse proxy (X-Forwarded-For) hoặc Cloudflare Tunnel (CF-Connecting-IP).
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIp } from "@/lib/api";

const mk = (headers: Record<string, string>) => new NextRequest("http://localhost/api/x", { headers });
const saved = { h: process.env.CLIENT_IP_HEADER, p: process.env.TRUSTED_PROXY_HOPS };
afterEach(() => {
  process.env.CLIENT_IP_HEADER = saved.h ?? "";
  process.env.TRUSTED_PROXY_HOPS = saved.p ?? "";
});

describe("clientIp", () => {
  it("mặc định (1 proxy): lấy phần tử XFF cuối, không tin phần tử client tự đặt", () => {
    process.env.CLIENT_IP_HEADER = "";
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(mk({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(mk({}))).toBe("direct");
  });

  it("CLIENT_IP_HEADER=cf-connecting-ip: dùng header Cloudflare, bỏ qua XFF giả", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(clientIp(mk({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }))).toBe("203.0.113.9");
    // Thiếu header (vd. gọi nội bộ trong mạng docker) → quay về cách cũ.
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(mk({ "x-forwarded-for": "10.0.0.5" }))).toBe("10.0.0.5");
  });
});
