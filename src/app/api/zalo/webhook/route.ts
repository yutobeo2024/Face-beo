import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { handle, HttpError } from "@/lib/api";
import { getAccessToken, isZaloSimulated, transport } from "@/lib/zalo-token";

/**
 * Webhook Zalo OA. Chữ ký: header X-ZEvent-Signature = "mac=" + sha256(appId + rawBody + timestamp + secret).
 * Nhân viên nhắn mã liên kết 6 ký tự => lưu zaloUserId.
 */
function verify(raw: string, timestamp: string, header: string | null): boolean {
  const secret = process.env.ZALO_WEBHOOK_SECRET;
  const appId = process.env.ZALO_OA_APP_ID ?? "";
  if (!secret) return process.env.NODE_ENV !== "production"; // chỉ cho phép không ký khi dev/mô phỏng
  if (!header) return false;
  const expected = "mac=" + createHash("sha256").update(appId + raw + timestamp + secret).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

async function reply(zaloUserId: string, text: string) {
  if (isZaloSimulated()) {
    console.log(`[ZALO MÔ PHỎNG] trả lời ${zaloUserId}: ${text}`);
    return;
  }
  try {
    await transport({ zaloUserId, text, accessToken: await getAccessToken() });
  } catch (e) {
    console.error("[zalo webhook] trả lời lỗi:", (e as Error).message);
  }
}

export const POST = handle(async (req) => {
  const raw = await req.text();
  let body: { event_name?: string; timestamp?: string | number; sender?: { id?: string }; message?: { text?: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON không hợp lệ");
  }
  if (!verify(raw, String(body.timestamp ?? ""), req.headers.get("x-zevent-signature"))) {
    throw new HttpError(401, "Chữ ký webhook không hợp lệ");
  }
  if (body.event_name !== "user_send_text" || !body.sender?.id) return NextResponse.json({ ok: true, ignored: true });

  const senderId = body.sender.id;
  const match = (body.message?.text ?? "").toUpperCase().match(/\b[A-Z2-9]{6}\b/);
  if (!match) return NextResponse.json({ ok: true, ignored: true });
  const link = await prisma.zaloLinkCode.findUnique({ where: { code: match[0] } });
  if (!link || link.expiresAt < new Date()) {
    // Zalo gửi lại sự kiện cũ sau khi đã liên kết thành công: bỏ qua, không báo "mã sai".
    if (await prisma.employee.findUnique({ where: { zaloUserId: senderId }, select: { id: true } })) {
      return NextResponse.json({ ok: true, ignored: true });
    }
    await reply(senderId, "Mã liên kết không đúng hoặc đã hết hạn. Vui lòng lấy mã mới trong mục Zalo của Face Beo.");
    return NextResponse.json({ ok: true, linked: false });
  }
  const emp = await prisma.$transaction(async (tx) => {
    await tx.employee.updateMany({ where: { zaloUserId: senderId, NOT: { id: link.employeeId } }, data: { zaloUserId: null, zaloLinkedAt: null } });
    const e = await tx.employee.update({ where: { id: link.employeeId }, data: { zaloUserId: senderId, zaloLinkedAt: new Date() } });
    await tx.zaloLinkCode.deleteMany({ where: { employeeId: link.employeeId } });
    return e;
  });
  await reply(senderId, `✅ Đã liên kết Zalo với tài khoản ${emp.code} — ${emp.name}. Bạn sẽ nhận thông báo chấm công và đơn từ tại đây.`);
  return NextResponse.json({ ok: true, linked: true });
});
