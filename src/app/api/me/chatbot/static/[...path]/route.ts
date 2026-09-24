import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertChatbotAllowed, fetchChatbotImage } from "@/lib/chatbot";

/**
 * Ảnh minh họa trong câu trả lời của Chat bot (v1.17.0). Ảnh nằm ở máy chủ chat bot, lấy hộ qua đây để:
 * (1) người chưa đăng nhập / chưa được cấp quyền không xem được, (2) trình duyệt không biết địa chỉ chat bot.
 */
export const GET = handle<{ path: string[] }>(async (req, ctx) => {
  const u = await requireUser(req);
  await assertChatbotAllowed(u);
  const { path } = await ctx.params;
  const img = await fetchChatbotImage((path ?? []).join("/"));
  return new Response(new Uint8Array(img.body), {
    headers: {
      "Content-Type": img.type,
      // Ảnh minh họa quy trình không đổi; giữ 10 phút trên máy người dùng cho đỡ tải lại khi cuộn.
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
