/**
 * Service worker tối thiểu (v1.14.0) — chỉ để trình duyệt cho phép "cài ứng dụng" và có trang báo mất mạng.
 * KHÔNG lưu đệm bất cứ thứ gì của ứng dụng: không tệp build, không API, không ảnh có kiểm quyền, không trang kiosk.
 * => cập nhật bản mới là thấy ngay, không có chuyện chạy bản cũ; dữ liệu có quyền không nằm lại trên máy.
 */
const CACHE = "facebeo-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Lấy lại trang offline mỗi lần kích hoạt: sửa offline.html là máy đã cài cũng nhận bản mới.
      .then(() => caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))).catch(() => {}))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // không đụng POST / PATCH (đăng nhập, chấm công…)
  if (req.mode !== "navigate") return; // chỉ lượt mở trang; mọi tài nguyên (tệp build, mô hình, ảnh) đi thẳng như thường
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/kiosk")) return; // kiosk có luồng camera + hàng chờ riêng, không xen vào
  // Có mạng: dùng đúng phản hồi máy chủ (không lưu lại). Mất mạng: hiện trang báo lỗi tĩnh.
  // caches.match có thể trả undefined (máy dọn bộ nhớ, Safari xóa sau ~7 ngày không dùng) → phải có phương án cuối, nếu không trình duyệt báo lỗi mạng.
  e.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) ?? new Response("Mất kết nối mạng — mở lại khi có mạng.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
  );
});
