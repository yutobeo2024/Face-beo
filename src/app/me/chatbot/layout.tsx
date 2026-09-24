import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { chatbotAllowed } from "@/lib/chatbot";

export const dynamic = "force-dynamic";

/**
 * Chặn ngay ở máy chủ (v1.17.0): người chưa được cấp quyền gõ thẳng /me/chatbot thì bị đưa về trang chính,
 * không phải mở ra trang chat rỗng rồi mới báo lỗi. API vẫn tự kiểm quyền riêng.
 */
export default async function ChatbotLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  if (!(await chatbotAllowed(u))) redirect("/me");
  return children;
}
