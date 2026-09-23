/**
 * Cài web app thành app trên máy (v1.14.0) — phần suy luận thuần (không đụng DOM) để test được:
 * đã cài chưa, trình duyệt có cài được không, và "Để sau" thì ẩn lời nhắc bao lâu.
 */
export const SNOOZE_KEY = "facebeo.install.snooze";
export const SNOOZE_DAYS = 14;
const DAY_MS = 86_400_000;

/** Nền tảng quyết định cách mời cài: Chrome/Edge có hộp thoại sẵn; iOS phải chỉ tay; webview trong Zalo/Facebook thì không cài được. */
export type Platform = "prompt" | "ios" | "webview" | "unsupported";

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const s = ua.toLowerCase();
  // iPadOS 13+ khai là "Macintosh" — nhận ra bằng cảm ứng.
  const ios = /iphone|ipad|ipod/.test(s) || (s.includes("macintosh") && maxTouchPoints > 1);
  if (/fban|fbav|fb_iab|instagram|zalo|line\/|micromessenger/.test(s)) return "webview";
  // Trên iOS chỉ Safari mới "Thêm vào MH chính" — Chrome/Firefox/Edge/Opera/DuckDuckGo/Brave iOS đều không làm được.
  const iosOther = /crios|fxios|edgios|opt\/|duckduckgo|brave/.test(s);
  if (/; wv\)|wv/.test(s)) return "webview"; // WebView Android nhúng trong app khác: không cài được
  if (ios) return iosOther ? "webview" : "ios";
  if (/chrome|chromium|crios|edg|samsungbrowser|opr\//.test(s)) return "prompt";
  return "unsupported"; // Firefox máy tính, trình duyệt lạ: không hiện gì còn hơn hiện nút bấm không ăn thua
}

/** Đang chạy dạng app (đã cài) — không nhắc, không hiện nút nữa. */
export function isInstalled(i: { standalone: boolean; iosStandalone: boolean; referrer: string }) {
  return i.standalone || i.iosStandalone || i.referrer.startsWith("android-app://");
}

export function parseSnooze(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export const snoozeUntil = (now: number) => now + SNOOZE_DAYS * DAY_MS;
export const isSnoozed = (until: number, now: number) => until > now;

/**
 * Thanh nhắc chỉ hiện khi: chưa cài, chưa bấm "Để sau" (còn hạn), không ở kiosk / trang đăng nhập, và trình duyệt cài được
 * (Chrome đã sẵn sàng mời cài, hoặc iOS Safari để hướng dẫn tay).
 */
export function shouldShowBanner(i: { installed: boolean; canPrompt: boolean; platform: Platform; snoozedUntil: number; now: number; pathname: string }) {
  if (i.installed || isSnoozed(i.snoozedUntil, i.now)) return false;
  if (i.pathname.startsWith("/kiosk") || i.pathname.startsWith("/login")) return false;
  return i.canPrompt || i.platform === "ios";
}

/** Mục "Cài ứng dụng" trong menu: luôn còn khi chưa cài (kể cả đã bấm "Để sau"), trừ khi trình duyệt không làm gì được. */
export function shouldShowMenuItem(i: { installed: boolean; canPrompt: boolean; platform: Platform }) {
  if (i.installed) return false;
  // "prompt" luôn có mục này: Chrome bắn lời mời một lần rất sớm, lỡ mất thì vẫn phải còn đường cài bằng tay.
  return i.canPrompt || i.platform !== "unsupported";
}
