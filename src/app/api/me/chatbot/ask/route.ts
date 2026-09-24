import { handle, json, HttpError, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CHAT_PER_MINUTE, askChatbot, assertChatbotAllowed, takeDailySlot, usageToday, CHAT_PER_DAY } from "@/lib/chatbot";
import { askSchema } from "./schema";


/**
 * Hỏi Chat bot (v1.17.0). Face Beo là cửa duy nhất: kiểm đăng nhập → kiểm quyền dùng → giới hạn tần suất →
 * gọi chat bot trong mạng nội bộ kèm khóa. Trình duyệt không thấy địa chỉ lẫn khóa của chat bot.
 * KHÔNG lưu câu hỏi / câu trả lời ở máy chủ — chỉ cộng một lượt vào bảng đếm.
 */
export const POST = handle(async (req) => {
  const u = await requireUser(req);
  await assertChatbotAllowed(u);
  const body = await parseJson(req, askSchema);
  if (!body.message && !body.attachments?.length) throw new HttpError(400, "Chưa nhập câu hỏi");

  const rl = rateLimit(`chatbot:${u.id}`, CHAT_PER_MINUTE);
  if (!rl.ok) throw new HttpError(429, `Bạn hỏi hơi nhanh — chờ ${rl.retryAfter} giây rồi hỏi tiếp nhé.`);
  // Giữ chỗ lượt hỏi trước khi gọi: mở nhiều tab hỏi cùng lúc cũng không vượt mức ngày. Hỏi hỏng thì trả lại lượt.
  const slot = await takeDailySlot(u.id);
  let reply;
  try {
    reply = await askChatbot({
      message: body.message || "Xem hình ảnh tôi gửi",
      attachments: body.attachments ?? [],
      history: body.history ?? [],
    });
  } catch (e) {
    await slot.refund();
    throw e;
  }
  return json({ ...reply, used: slot.used, limit: CHAT_PER_DAY });
});

/** Số lượt đã hỏi hôm nay (hiện ở góc trang chat). */
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  await assertChatbotAllowed(u);
  return json({ used: await usageToday(u.id), limit: CHAT_PER_DAY });
});
