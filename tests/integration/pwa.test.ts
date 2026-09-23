// v1.14.0: cài web app thành app (PWA) — manifest app nhân sự, manifest kiosk không đổi, service worker không lưu đệm bậy,
// và luật hiện/ẩn lời nhắc. Phần trình duyệt (beforeinstallprompt, display-mode, cài thật) phải thử tay — xem docs.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SNOOZE_DAYS, detectPlatform, isInstalled, isSnoozed, parseSnooze, shouldShowBanner, shouldShowMenuItem, snoozeUntil } from "@/lib/pwa";

const pub = (f: string) => join(process.cwd(), "public", f);
const sw = readFileSync(pub("sw.js"), "utf8");

describe("manifest app nhân sự", () => {
  const m = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8")) as { icons?: { src: string; sizes: string; purpose?: string }[] } & Record<string, unknown>;

  it("cài được trên toàn ứng dụng, mở thẳng /me, không thanh địa chỉ", () => {
    expect(m).toMatchObject({ name: "Face Beo", scope: "/", start_url: "/me", display: "standalone", theme_color: "#10695a", lang: "vi" });
  });

  it("đủ icon theo yêu cầu của Chrome (192 + 512 + maskable) và file có thật", () => {
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of icons) expect(existsSync(pub(i.src)), i.src).toBe(true);
    expect(existsSync(pub("icons/apple-touch-icon.png"))).toBe(true);
  });

  it("kiosk giữ nguyên manifest cũ (toàn màn hình, khóa ngang, phạm vi /kiosk) và trang kiosk trỏ đúng vào nó", () => {
    const k = JSON.parse(readFileSync(pub("kiosk.webmanifest"), "utf8"));
    expect(k).toMatchObject({ name: "Face Beo Kiosk", start_url: "/kiosk", scope: "/kiosk", display: "fullscreen", orientation: "landscape", theme_color: "#020617" });
    expect(existsSync(pub(k.icons[0].src))).toBe(true);
    // Đọc mã nguồn (vitest chạy môi trường node, không dựng được .tsx): trang kiosk phải khai manifest riêng, nếu không sẽ ăn manifest gốc.
    expect(readFileSync(join(process.cwd(), "src", "app", "kiosk", "layout.tsx"), "utf8")).toContain('manifest: "/kiosk.webmanifest"');
  });
});

describe("service worker", () => {
  it("không lưu đệm mã nguồn ứng dụng, API hay ảnh có kiểm quyền", () => {
    expect(sw).not.toMatch(/cache\.put|addAll|_next/);
    // Chỉ một thứ duy nhất được lưu: trang báo mất mạng (lấy lúc cài + lúc kích hoạt để máy đã cài nhận bản mới).
    expect(sw.match(/\.add\(/g)).toHaveLength(2);
    expect(sw.match(/OFFLINE_URL/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sw).toContain("/offline.html");
  });

  it("bỏ qua API, kiosk, yêu cầu ghi và tài nguyên (chỉ xử lý lượt mở trang)", () => {
    for (const guard of ['req.method !== "GET"', 'req.mode !== "navigate"', '/api/', '/kiosk']) expect(sw).toContain(guard);
  });

  it("cập nhật ngay khi có bản mới", () => {
    expect(sw).toContain("skipWaiting");
    expect(sw).toContain("clients.claim");
  });

  it("trang mất mạng là tĩnh, không gọi API cũng không dùng file build", () => {
    const off = readFileSync(pub("offline.html"), "utf8");
    expect(off).not.toMatch(/\/_next\/|\/api\//);
    expect(off).toContain("Mất kết nối");
  });

  it("sw.js và manifest không bị giữ bản cũ; /models giữ nguyên luật cũ", async () => {
    const headers = await nextConfig.headers!();
    const find = (src: string) => headers.find((h) => h.source === src)?.headers ?? [];
    expect(find("/sw.js")).toContainEqual({ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" });
    expect(find("/sw.js")).toContainEqual({ key: "Service-Worker-Allowed", value: "/" });
    expect(find("/:file(manifest.webmanifest|kiosk.webmanifest|offline.html)")[0].value).toContain("must-revalidate");
    expect(find("/models/:path*")).toContainEqual({ key: "Cache-Control", value: "public, max-age=604800, immutable" });
  });
});

describe("luật hiện lời nhắc cài", () => {
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A martin) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

  it("nhận đúng nền tảng", () => {
    expect(detectPlatform(IOS)).toBe("ios");
    expect(detectPlatform(ANDROID)).toBe("prompt");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15", 5)).toBe("ios"); // iPad khai là Macintosh
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0) Chrome/124.0.0.0 Safari/537.36")).toBe("prompt");
    expect(detectPlatform(`${IOS} Zalo/23.09`)).toBe("webview");
    expect(detectPlatform(`${ANDROID} FBAV/450.0`)).toBe("webview");
    expect(detectPlatform(IOS.replace("Version/17.4", "CriOS/124.0"))).toBe("webview"); // Chrome trên iOS không thêm được
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36")).toBe("webview"); // WebView nhúng
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; rv:125.0) Gecko/20100101 Firefox/125.0")).toBe("unsupported");
  });

  it("đang chạy dạng app thì coi như đã cài", () => {
    expect(isInstalled({ standalone: true, iosStandalone: false, referrer: "" })).toBe(true);
    expect(isInstalled({ standalone: false, iosStandalone: true, referrer: "" })).toBe(true);
    expect(isInstalled({ standalone: false, iosStandalone: false, referrer: "android-app://com.android.chrome" })).toBe(true);
    expect(isInstalled({ standalone: false, iosStandalone: false, referrer: "https://face.ydsg.website/" })).toBe(false);
  });

  it(`"Để sau" ẩn lời nhắc ${SNOOZE_DAYS} ngày rồi nhắc lại`, () => {
    const now = Date.UTC(2026, 8, 23);
    const until = snoozeUntil(now);
    expect(until - now).toBe(SNOOZE_DAYS * 86_400_000);
    expect(isSnoozed(until, now + 13 * 86_400_000)).toBe(true);
    expect(isSnoozed(until, now + SNOOZE_DAYS * 86_400_000)).toBe(false);
    expect(parseSnooze(null)).toBe(0);
    expect(parseSnooze("rác")).toBe(0);
    expect(parseSnooze(String(until))).toBe(until);
  });

  it("thanh nhắc: hiện khi chưa cài; ẩn khi đã cài / đang hoãn / ở kiosk / trang đăng nhập / trình duyệt không cài được", () => {
    const base = { installed: false, canPrompt: true, platform: "prompt" as const, snoozedUntil: 0, now: 1000, pathname: "/me" };
    expect(shouldShowBanner(base)).toBe(true);
    expect(shouldShowBanner({ ...base, installed: true })).toBe(false);
    expect(shouldShowBanner({ ...base, snoozedUntil: 2000 })).toBe(false);
    expect(shouldShowBanner({ ...base, pathname: "/kiosk" })).toBe(false);
    expect(shouldShowBanner({ ...base, pathname: "/login" })).toBe(false);
    expect(shouldShowBanner({ ...base, canPrompt: false, platform: "ios" })).toBe(true); // iOS: hướng dẫn tay
    expect(shouldShowBanner({ ...base, canPrompt: false, platform: "webview" })).toBe(false);
    expect(shouldShowBanner({ ...base, canPrompt: false, platform: "unsupported" })).toBe(false);
  });

  it("mục trong menu: còn sau khi bấm Để sau, mất hẳn khi đã cài", () => {
    expect(shouldShowMenuItem({ installed: false, canPrompt: true, platform: "prompt" })).toBe(true);
    expect(shouldShowMenuItem({ installed: false, canPrompt: false, platform: "ios" })).toBe(true);
    expect(shouldShowMenuItem({ installed: false, canPrompt: false, platform: "webview" })).toBe(true); // hiện để chỉ cách mở bằng trình duyệt
    expect(shouldShowMenuItem({ installed: false, canPrompt: false, platform: "prompt" })).toBe(true); // Chrome lỡ mất lời mời: vẫn còn đường cài tay
    expect(shouldShowMenuItem({ installed: false, canPrompt: false, platform: "unsupported" })).toBe(false);
    expect(shouldShowMenuItem({ installed: true, canPrompt: true, platform: "prompt" })).toBe(false);
  });
});
