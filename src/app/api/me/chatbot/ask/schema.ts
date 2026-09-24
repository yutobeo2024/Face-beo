import { z } from "zod";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, MAX_MESSAGE_CHARS, base64Chars } from "@/lib/chatbot";

/** Dữ liệu một lượt hỏi — dùng chung cho kiểu trả lời một lần và kiểu theo luồng. */
const attachment = z.object({
  // Ảnh gửi kèm dưới dạng base64 (không kèm phần "data:image/...;base64,").
  data: z.string().min(1).max(base64Chars(MAX_ATTACHMENT_BYTES)),
  mime_type: z.string().regex(/^image\/(png|jpe?g|webp|gif|heic|heif)$/i, "Chỉ nhận ảnh"),
});
export const askSchema = z.object({
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
