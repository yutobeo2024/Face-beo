/**
 * Đổi đường ảnh trong câu trả lời của Chat bot (v1.18.0) — dùng được cả ở máy chủ lẫn trình duyệt.
 * Ảnh nằm ở máy chủ chat bot (`/static/images/...`); Face Beo lấy hộ qua `/api/me/chatbot/static/...` để kiểm quyền.
 * Trả lời theo luồng thì chữ về từng mẩu, cắt ngang giữa đường dẫn được, nên phải đổi trên TOÀN văn bản đã nhận
 * chứ không đổi trên từng mẩu.
 */
export const IMAGE_PROXY_PREFIX = "/api/me/chatbot/static/";

/** Ảnh nằm trong Markdown `![…](/static/images/…)` hoặc thẻ `<img src="/static/images/…">`. */
export function rewriteImagePaths(markdown: string): string {
  return markdown.replaceAll("](/static/images/", `](${IMAGE_PROXY_PREFIX}images/`).replaceAll('="/static/images/', `="${IMAGE_PROXY_PREFIX}images/`);
}

/** Một đường ảnh đứng riêng (trong danh sách "nguồn"), không nằm trong Markdown. */
export function rewriteImageUrl(url: string): string {
  return url.startsWith("/static/images/") ? IMAGE_PROXY_PREFIX + url.slice("/static/".length) : url;
}
