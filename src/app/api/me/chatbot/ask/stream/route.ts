import { handle, HttpError, parseJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CHAT_PER_MINUTE, CHAT_PER_DAY, askChatbot, askChatbotStream, assertChatbotAllowed, chatbotViewer, takeDailySlot } from "@/lib/chatbot";
import { rewriteImageUrl } from "@/lib/client/chatbot-text";
import { askSchema } from "../schema";

/**
 * Hỏi Chat bot, chữ hiện dần (v1.18.0). Cùng luật với `/api/me/chatbot/ask`: đăng nhập → quyền dùng →
 * 10 câu/phút → giữ chỗ trong hạn mức ngày → gọi chat bot trong mạng nội bộ kèm khóa.
 * Máy chủ KHÔNG lưu nội dung; chỉ đọc luồng của chat bot rồi phát lại cho trình duyệt.
 *
 * Sự kiện gửi về trình duyệt (SSE), đúng thứ tự: `sources` → `used` → nhiều `chunk` → `done`; hỏng thì `error`.
 * Đọc rồi phát lại (thay vì bơm thẳng byte) để: đổi đường ảnh trong danh sách nguồn, biết chắc đã có chữ hay chưa
 * (quyết định hoàn lượt), và chèn `used` đúng chỗ — dò chuỗi trên từng gói mạng thì sai khi gói bị cắt giữa chừng.
 */
export const POST = handle(async (req) => {
  const u = await requireUser(req);
  await assertChatbotAllowed(u);
  const body = await parseJson(req, askSchema);
  if (!body.message && !body.attachments?.length) throw new HttpError(400, "Chưa nhập câu hỏi");

  const rl = rateLimit(`chatbot:${u.id}`, CHAT_PER_MINUTE);
  if (!rl.ok) throw new HttpError(429, `Bạn hỏi hơi nhanh — chờ ${rl.retryAfter} giây rồi hỏi tiếp nhé.`);
  const viewer = await chatbotViewer(u); // đọc DB trước khi giữ lượt: lỗi ở đây không làm mất lượt hỏi
  const slot = await takeDailySlot(u.id);

  const ask = { message: body.message || "Xem hình ảnh tôi gửi", attachments: body.attachments ?? [], history: body.history ?? [] };
  let upstream: ReadableStream<Uint8Array> | null;
  try {
    upstream = await askChatbotStream(ask, viewer);
  } catch (e) {
    await slot.refund();
    throw e;
  }

  const encoder = new TextEncoder();
  const frame = (name: string, data: unknown) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const usedFrame = () => frame("used", { used: slot.used, limit: CHAT_PER_DAY });
  const LOI_CHUNG = "Chat bot trả lời lỗi. Thử lại sau ít phút.";

  // Chat bot đời cũ chưa có đường luồng: hỏi kiểu cũ rồi gửi một lần, trình duyệt không cần biết khác biệt.
  if (!upstream) {
    let reply;
    try {
      reply = await askChatbot(ask, viewer);
    } catch (e) {
      await slot.refund();
      throw e;
    }
    return sseResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame("sources", { sources: reply.sources }));
          controller.enqueue(usedFrame());
          controller.enqueue(frame("chunk", { text: reply.reply_text }));
          controller.enqueue(frame("done", {}));
          controller.close();
        },
      }),
    );
  }

  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawChunk = false;
  let sentUsed = false;
  let failed = false;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Gemini có thể im lặng cả phút trước chữ đầu tiên; gửi nhịp giữ nhịp để proxy không cắt kết nối.
      ping = setInterval(() => {
        if (!sawChunk) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* luồng đã đóng */
          }
        }
      }, 15_000);

      /** Một sự kiện SSE của chat bot → phát lại cho trình duyệt (đổi đường ảnh, chèn `used` trước chunk đầu). */
      const forward = (name: string, data: Record<string, unknown>) => {
        if (name === "chunk" && typeof data.text === "string") {
          if (!sentUsed) {
            sentUsed = true;
            controller.enqueue(usedFrame());
          }
          sawChunk = true;
          controller.enqueue(frame("chunk", { text: data.text }));
          return;
        }
        if (name === "sources") {
          const list = Array.isArray(data.sources) ? data.sources : [];
          const sources = list
            .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
            .map((s) => ({ ...s, image_url: typeof s.image_url === "string" ? rewriteImageUrl(s.image_url) : "" }));
          controller.enqueue(frame("sources", { sources }));
          return;
        }
        // `error` do chat bot gửi được xử lý ở vòng đọc (fail) để hoàn lượt đúng một lần.
        if (name === "done") controller.enqueue(frame("done", {}));
      };

      const fail = async () => {
        if (failed) return; // chỉ báo lỗi một lần dù luồng vừa gửi `error` vừa đóng sớm
        failed = true;
        // Chưa nói được chữ nào thì trả lại lượt; đã ra chữ rồi thì tính (chat bot đã tốn tiền gọi).
        if (!sawChunk) await slot.refund();
        controller.enqueue(frame("error", { detail: LOI_CHUNG }));
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const name = /^event:\s*(.+)$/m.exec(part)?.[1]?.trim();
            if (!name) continue; // dòng nhịp ": ping" của chat bot
            const raw = /^data:\s*(.*)$/m.exec(part)?.[1] ?? "{}";
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (name === "error") await fail();
            else forward(name, data);
          }
        }
        // Chat bot đóng luồng mà chưa nói chữ nào (chết giữa chừng).
        if (!sawChunk) await fail();
      } catch {
        await reader.cancel().catch(() => {});
        await fail();
      } finally {
        clearInterval(ping);
        controller.close();
      }
    },
    async cancel() {
      // Người dùng đóng trang / bấm Dừng: buông kết nối tới chat bot, chưa ra chữ thì trả lại lượt.
      clearInterval(ping);
      await reader.cancel().catch(() => {});
      if (!sawChunk) await slot.refund();
    },
  });
  return sseResponse(stream);
});

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Tắt đệm của proxy (Caddy / Cloudflare): bị đệm thì luồng mất tác dụng.
      "X-Accel-Buffering": "no",
    },
  });
}
