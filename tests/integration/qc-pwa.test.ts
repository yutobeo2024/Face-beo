// QC v1.14.0 (PWA): các ca hiểm không có trong tests/integration/pwa.test.ts —
// icon PNG có đúng là PNG đúng kích thước không, manifest có dựng được JSON không, sw.js có phải JavaScript hợp lệ không,
// luật cache header chọn đúng rule cho /sw.js, và pwa.ts chịu đầu vào bẩn (không được ném lỗi).
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { detectPlatform, isInstalled, isSnoozed, parseSnooze, shouldShowBanner, shouldShowMenuItem, snoozeUntil, type Platform } from "@/lib/pwa";

const pub = (f: string) => join(process.cwd(), "public", f);
const sw = readFileSync(pub("sw.js"), "utf8");
const offline = readFileSync(pub("offline.html"), "utf8");
type Icon = { src: string; sizes: string; type?: string; purpose?: string };
type Manifest = { scope?: string; start_url?: string; icons?: Icon[]; shortcuts?: { name: string; url: string }[] } & Record<string, unknown>;
const m: Manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "manifest.webmanifest"), "utf8"));

const PLATFORMS: Platform[] = ["prompt", "ios", "webview", "unsupported"];

describe("QC icon PWA", () => {
  const declared = [
    ...(m.icons ?? []).map((i) => ({ src: i.src, size: Number(String(i.sizes).split("x")[0]), maskable: i.purpose === "maskable" })),
    { src: "/icons/apple-touch-icon.png", size: 180, maskable: true }, // iOS bo góc => cũng không được trong suốt
  ];

  for (const ic of declared) {
    it(`${ic.src} là PNG thật, đúng ${ic.size}×${ic.size}, dung lượng hợp lý`, async () => {
      const file = pub(ic.src);
      expect(existsSync(file), `thiếu file ${ic.src}`).toBe(true);
      const buf = readFileSync(file);
      // Chữ ký PNG: 89 50 4E 47 0D 0A 1A 0A — tránh chuyện đặt tên .png cho file SVG/JPEG.
      expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const meta = await sharp(buf).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([ic.size, ic.size]);
      expect(statSync(file).size, `${ic.src} quá nặng`).toBeLessThan(100 * 1024);
    });
  }

  for (const ic of declared.filter((i) => i.maskable)) {
    it(`${ic.src} (maskable) kín góc — hệ điều hành cắt tròn không lòi nền lạ`, async () => {
      const { data, info } = await sharp(pub(ic.src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
      const corners = [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)];
      expect(corners, `góc trong suốt ở ${ic.src}`).toEqual([255, 255, 255, 255]);
    });
  }

  it("mỗi icon khai báo một lần, đường dẫn tuyệt đối, đúng kiểu image/png", () => {
    const srcs = (m.icons ?? []).map((i) => `${i.src}|${i.purpose}`);
    expect(new Set(srcs).size).toBe(srcs.length);
    for (const i of m.icons ?? []) {
      expect(i.src.startsWith("/"), i.src).toBe(true);
      expect(i.type).toBe("image/png");
      expect(i.sizes).toMatch(/^\d+x\d+$/);
    }
  });
});

describe("QC manifest", () => {
  it("dựng được JSON, không có undefined / NaN ở bất kỳ nhánh nào", () => {
    const json = JSON.stringify(m);
    expect(JSON.parse(json)).toEqual(m); // undefined bị JSON.stringify nuốt => khác nhau là có undefined
    const walk = (v: unknown, path: string) => {
      expect(v, `undefined tại ${path}`).not.toBe(undefined);
      if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(m, "manifest");
    expect(json.length).toBeLessThan(8192);
  });

  it("start_url và mọi lối tắt nằm trong scope; không trỏ vào kiosk", () => {
    const scope = m.scope ?? "/";
    const urls = [m.start_url!, ...(m.shortcuts ?? []).map((s) => s.url)];
    for (const u of urls) {
      expect(u.startsWith("/"), u).toBe(true);
      expect(u.startsWith(scope), `${u} ngoài scope ${scope}`).toBe(true);
      expect(u.startsWith("/kiosk"), `${u} không được trỏ vào kiosk`).toBe(false);
    }
  });

  it("kiosk.webmanifest vẫn đọc được, icon có thật, start_url trong scope của nó", () => {
    const raw = readFileSync(pub("kiosk.webmanifest"), "utf8");
    const k = JSON.parse(raw) as { start_url: string; scope: string; icons: { src: string }[] };
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(k.start_url.startsWith(k.scope)).toBe(true);
    for (const i of k.icons) expect(existsSync(pub(i.src)), i.src).toBe(true);
    // Hai manifest không được trùng scope: kiosk hẹp hơn app nhân sự.
    expect(k.scope).not.toBe(m.scope);
    expect(k.scope.startsWith(m.scope ?? "/")).toBe(true);
  });
});

describe("QC service worker", () => {
  it("là JavaScript hợp lệ (biên dịch được, không chạy) và không dùng import/export", () => {
    expect(() => new vm.Script(sw, { filename: "sw.js" })).not.toThrow(); // classic worker: cú pháp sai => SW không đăng ký được
    expect(sw).not.toMatch(/^\s*(?:import|export)\b/m);
    expect(sw).not.toMatch(/\bimport\s*\(/);
    expect(sw).not.toMatch(/\brequire\s*\(/);
  });

  it("không đụng cookie/IndexedDB/postMessage tới nơi khác, không lưu phản hồi có quyền", () => {
    expect(sw).not.toMatch(/cache\.put|cachesput|response\.clone|indexedDB|cookieStore/);
  });

  it("mọi nhánh respondWith luôn trả về Response (caches.match có thể là undefined)", () => {
    // caches.match() trả undefined khi bộ nhớ đệm bị hệ điều hành dọn (Safari xóa sau 7 ngày, máy hết chỗ).
    // respondWith(undefined) => TypeError => người dùng thấy trang lỗi mạng của trình duyệt thay vì trang "Mất kết nối".
    const hasFallback = /caches\.match\([^)]*\)[^;]*?(\?\?|\|\||\.then\s*\([^)]*\|\|)/s.test(sw) || /new Response\(/.test(sw);
    expect(hasFallback, "caches.match(OFFLINE_URL) không có dự phòng new Response(...) khi cache trống").toBe(true);
  });

  it("chỉ xử lý cùng origin và không tự lấy lại yêu cầu ghi", () => {
    expect(sw).toContain("self.location.origin");
    expect(sw.match(/e\.respondWith\(/g) ?? []).toHaveLength(1);
  });
});

describe("QC trang mất mạng", () => {
  it("không gọi ra ngoài mạng: không http(s)://, không //cdn, không /_next, không fetch/XHR", () => {
    expect(offline).not.toMatch(/https?:\/\//);
    expect(offline).not.toMatch(/src\s*=\s*["']\/\//);
    expect(offline).not.toMatch(/\/_next\//);
    expect(offline).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|import\s*\(/);
  });

  it("mọi tài nguyên tham chiếu đều là file có thật trong public", () => {
    const refs = [...offline.matchAll(/(?:src|href)\s*=\s*"(\/[^"]+)"/g)].map((x) => x[1]);
    for (const r of refs) expect(existsSync(pub(r)), `offline.html trỏ tới ${r} không tồn tại`).toBe(true);
  });
});

describe("QC cache header", () => {
  const match = (source: string, path: string) => {
    const re = source
      .replace(/[.]/g, "\\.")
      .replace(/\/:\w+\(([^)]*)\)/g, "/($1)")
      .replace(/\/:\w+\*/g, "(?:/.*)?")
      .replace(/\/:\w+/g, "/[^/]+");
    return new RegExp(`^${re}$`).test(path);
  };

  it("headers() trả về cấu trúc hợp lệ (source + cặp key/value là chuỗi)", async () => {
    const headers = await nextConfig.headers!();
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(typeof h.source).toBe("string");
      expect(h.source.startsWith("/")).toBe(true);
      expect(Array.isArray(h.headers)).toBe(true);
      for (const kv of h.headers) {
        expect(typeof kv.key).toBe("string");
        expect(typeof kv.value).toBe("string");
        expect(kv.value.length).toBeGreaterThan(0);
      }
    }
  });

  it("/sw.js chỉ có đúng một luật Cache-Control và là luật không lưu đệm", async () => {
    const headers = await nextConfig.headers!();
    const hit = headers.filter((h) => match(h.source, "/sw.js"));
    const cc = hit.flatMap((h) => h.headers.filter((k) => k.key.toLowerCase() === "cache-control"));
    expect(cc).toHaveLength(1);
    expect(cc[0].value).toMatch(/no-store/);
    expect(cc[0].value).not.toMatch(/immutable|max-age=[1-9]/);
    // Header an toàn chung vẫn phải phủ lên /sw.js.
    expect(hit.some((h) => h.headers.some((k) => k.key === "X-Content-Type-Options"))).toBe(true);
  });

  it("manifest/offline không bị giữ bản cũ; icon được giữ lâu; icon KHÔNG dính luật no-store", async () => {
    const headers = await nextConfig.headers!();
    const cc = (p: string) =>
      headers
        .filter((h) => match(h.source, p))
        .flatMap((h) => h.headers.filter((k) => k.key.toLowerCase() === "cache-control"))
        .map((k) => k.value);
    expect(cc("/manifest.webmanifest")).toEqual(["public, max-age=0, must-revalidate"]);
    expect(cc("/kiosk.webmanifest")).toEqual(["public, max-age=0, must-revalidate"]);
    expect(cc("/offline.html")).toEqual(["public, max-age=0, must-revalidate"]);
    expect(cc("/icons/icon-192.png")).toEqual(["public, max-age=604800"]);
    expect(cc("/models/w600k_r50.onnx")).toEqual(["public, max-age=604800, immutable"]);
  });
});

describe("QC pwa.ts chịu đầu vào bẩn", () => {
  const HOSTILE: unknown[] = [
    "",
    " ",
    "\u0000",
    "x".repeat(100_000),
    "Chrome".repeat(5_000),
    "🙂🙃 iPhone 🙂",
    "ＩＰＨＯＮＥ", // ký tự rộng
    "iphone\niphone",
    "<script>alert(1)</script>",
    "Mozilla/5.0 (iPhone) ".repeat(500),
    "null",
    "undefined",
    "Infinity",
  ];

  it("detectPlatform không bao giờ ném lỗi và luôn trả về một nền tảng hợp lệ", () => {
    for (const ua of HOSTILE) {
      let out: Platform | undefined;
      expect(() => (out = detectPlatform(ua as string)), String(ua).slice(0, 30)).not.toThrow();
      expect(PLATFORMS).toContain(out);
    }
    for (const touch of [-1, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
      expect(() => detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605", touch)).not.toThrow();
      expect(PLATFORMS).toContain(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605", touch));
    }
    // Chuỗi rỗng / rác => "unsupported": thà không hiện gì còn hơn hiện nút bấm không ăn thua.
    expect(detectPlatform("")).toBe("unsupported");
    expect(detectPlatform("x".repeat(10_000))).toBe("unsupported");
  });

  it("parseSnooze luôn ra số hữu hạn ≥ 0 với mọi rác (Infinity, âm, số mũ, khoảng trắng)", () => {
    const cases: (string | null)[] = [
      null,
      "",
      " ",
      "0",
      "-1",
      "-99999999999999",
      "Infinity",
      "-Infinity",
      "1e999",
      "NaN",
      "  1700000000000  ",
      "0x10",
      "1,5",
      "12abc",
      "9".repeat(400),
      "[object Object]",
      "🙂",
      "true",
    ];
    for (const raw of cases) {
      const n = parseSnooze(raw);
      expect(Number.isFinite(n), `parseSnooze(${raw}) = ${n}`).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
    expect(parseSnooze("-1")).toBe(0);
    expect(parseSnooze("Infinity")).toBe(0);
    expect(parseSnooze("1e999")).toBe(0);
    expect(parseSnooze("0x10")).toBe(16); // Number("0x10") = 16 — vô hại: vẫn là mốc thời gian quá khứ
    expect(parseSnooze("  1700000000000  ")).toBe(1_700_000_000_000);
    // Rác ở localStorage không được khóa vĩnh viễn lời nhắc: mọi giá trị hỏng đều thành 0 (không hoãn).
    expect(isSnoozed(parseSnooze("rác"), Date.now())).toBe(false);
    // Kể cả người dùng tự đặt mốc xa tít, thời gian vẫn vượt qua được (số hữu hạn).
    expect(isSnoozed(parseSnooze("9".repeat(400)), Date.now())).toBe(false);
  });

  it("snoozeUntil/isSnoozed ổn định quanh mốc 0, NaN và số rất lớn", () => {
    expect(snoozeUntil(0)).toBe(14 * 86_400_000);
    expect(isSnoozed(Number.NaN, Date.now())).toBe(false);
    expect(isSnoozed(snoozeUntil(Number.NaN), Date.now())).toBe(false);
    expect(isSnoozed(snoozeUntil(Date.now()), Date.now())).toBe(true);
  });

  it("isInstalled với referrer lạ không nhầm là đã cài", () => {
    const base = { standalone: false, iosStandalone: false };
    for (const referrer of ["", "http://android-app://x", " android-app://x", "ANDROID-APP://x", "https://kẻ-xấu/android-app://"]) {
      expect(isInstalled({ ...base, referrer }), referrer).toBe(false);
    }
    expect(isInstalled({ ...base, referrer: "android-app://com.android.chrome" })).toBe(true);
  });
});

describe("QC bảng chân trị hiện/ẩn", () => {
  it("thanh nhắc: đúng với mọi tổ hợp nền tảng × canPrompt × đã cài × đường dẫn", () => {
    for (const platform of PLATFORMS)
      for (const canPrompt of [true, false])
        for (const installed of [true, false])
          for (const pathname of ["/me", "/", "/kiosk", "/kiosk/enroll", "/login", "/login?next=/me", "/employees"])
            for (const snoozedUntil of [0, 5_000]) {
              const now = 1_000;
              const expected =
                !installed && !(snoozedUntil > now) && !pathname.startsWith("/kiosk") && !pathname.startsWith("/login") && (canPrompt || platform === "ios");
              expect(shouldShowBanner({ installed, canPrompt, platform, snoozedUntil, now, pathname }), JSON.stringify({ platform, canPrompt, installed, pathname, snoozedUntil })).toBe(expected);
            }
  });

  it("thanh nhắc luôn ẩn ở kiosk và trang đăng nhập, kể cả khi mọi thứ khác đều thuận", () => {
    for (const pathname of ["/kiosk", "/kioskx", "/login", "/loginx"]) {
      const v = shouldShowBanner({ installed: false, canPrompt: true, platform: "prompt", snoozedUntil: 0, now: 1, pathname });
      expect(v, pathname).toBe(false); // prefix: /kioskx, /loginx cũng ẩn — chấp nhận được vì không có route nào như vậy
    }
  });

  it("mục menu: đúng với mọi tổ hợp; webview vẫn hiện để chỉ cách mở bằng trình duyệt", () => {
    for (const platform of PLATFORMS)
      for (const canPrompt of [true, false])
        for (const installed of [true, false]) {
          // v1.14.0: mọi nền tảng có đường cài (kể cả "prompt" khi Chrome đã bắn lời mời trước lúc React chạy) đều còn mục menu.
          const expected = !installed && (canPrompt || platform !== "unsupported");
          expect(shouldShowMenuItem({ installed, canPrompt, platform }), JSON.stringify({ platform, canPrompt, installed })).toBe(expected);
        }
  });

  it("đã cài thì không còn gì hiện, dù trình duyệt vẫn mời cài", () => {
    for (const platform of PLATFORMS) {
      expect(shouldShowMenuItem({ installed: true, canPrompt: true, platform })).toBe(false);
      expect(shouldShowBanner({ installed: true, canPrompt: true, platform, snoozedUntil: 0, now: 1, pathname: "/me" })).toBe(false);
    }
  });
});
