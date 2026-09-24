import { z } from "zod";
import { handle, json, HttpError, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CHAT_PER_MINUTE, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, MAX_MESSAGE_CHARS, askChatbot, assertChatbotAllowed, takeDailySlot, usageToday, base64Chars, CHAT_PER_DAY } from "@/lib/chatbot";

const attachment = z.object({
  // Ảnh gửi kèm dưới dạng base64 (không kèm phần "data:image/...;base64,").
  data: z.string().min(1).max(base64Chars(MAX_ATTACHMENT_BYTES)),
  mime_type: z.string().regex(/^image\/(png|jpe?g|webp|gif|heic|heif)$/i, "Chỉ nhận ảnh"),
});
const schema = z.object({
  message: z.string().trim().max(MAX_MESSAGE_CHARS),
  attachments: z
    .array(attachment)
    .max(MAX_ATTACHMENTS)
    // Chặn cả tổng dung lượng, không chỉ từng tấm.
    .refine((a) => a.reduce((n, x) => n + x.data.length, 0) <= base64Chars(MAX_ATTACHMENT_TOTAL_BYTES), "Tổng dung lượng ảnh quá lớn — gửi ít ảnh hoặc ảnh nhỏ hơn")
    .optional(),
  // Ngữ cảnh vài lượt gần nhất để chat bot hiểu câu hỏi nối tiếp; máy chủ KHÔNG lưu lại.
  history: z.array(z.object({ role: z.enum(["user", "ai"]), content: z.string().max(MAX_MESSAGE_CHARS) })).max(10).optional(),
});

/**
 * Hỏi Chat bot (v1.17.0). Face Beo là cửa duy nhất: kiểm đăng nhập → kiểm quyền dùng → giới hạn tần suất →
 * gọi chat bot trong mạng nội bộ kèm khóa. Trình duyệt không thấy địa chỉ lẫn khóa của chat bot.
 * KHÔNG lưu câu hỏi / câu trả lời ở máy chủ — chỉ cộng một lượt vào bảng đếm.
 */
export const POST = handle(async (req) => {
  const u = await requireUser(req);
  await assertChatbotAllowed(u);
  const body = await parseJson(req, schema);
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
