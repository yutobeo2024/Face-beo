/** Mẫu nội dung tin Zalo OA (PRD mục 7). Mỗi loại một hàm nhận data, trả chuỗi tiếng Việt kèm link. */
import { env } from "./env";

export type MessageType = "REQUEST_CREATED" | "REQUEST_DECIDED" | "LATE_REMINDER" | "ABSENT_WARNING" | "ABSENT_DIGEST" | "GROUP_EVENT";

const link = (path: string) => `${env.appBaseUrl.replace(/\/$/, "")}${path}`;

type Data = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export const zaloTemplates: Record<MessageType, (d: Data) => string> = {
  REQUEST_CREATED: (d) =>
    [
      `📝 Đơn mới cần duyệt`,
      `${s(d.employeeName)} (${s(d.employeeCode)}) gửi đơn ${s(d.typeLabel)}.`,
      `Thời gian: ${s(d.fromText)} → ${s(d.toText)}`,
      `Lý do: ${s(d.reason)}`,
      `Duyệt tại: ${link("/admin/requests?status=PENDING")}`,
    ].join("\n"),
  REQUEST_DECIDED: (d) =>
    [
      d.status === "APPROVED" ? `✅ Đơn của bạn đã được duyệt` : `❌ Đơn của bạn bị từ chối`,
      `Loại: ${s(d.typeLabel)} (${s(d.fromText)} → ${s(d.toText)})`,
      d.decisionNote ? `Ghi chú: ${s(d.decisionNote)}` : "",
      `Người xử lý: ${s(d.approverName)}`,
      `Xem chi tiết: ${link("/me/requests")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  LATE_REMINDER: (d) =>
    [
      `⏰ Nhắc đi trễ`,
      `Bạn chấm vào lúc ${s(d.timeText)} ngày ${s(d.dateText)}, trễ ${s(d.lateMinutes)} phút so với ca ${s(d.shiftName)}.`,
      `Nếu có lý do, vui lòng tạo đơn: ${link("/me/requests?new=1")}`,
    ].join("\n"),
  ABSENT_WARNING: (d) =>
    [
      `⚠️ Chưa ghi nhận chấm công`,
      `Ca ${s(d.shiftName)} ngày ${s(d.dateText)} bắt đầu lúc ${s(d.startText)} nhưng hệ thống chưa thấy bạn chấm vào.`,
      `Nếu bạn nghỉ, vui lòng tạo đơn: ${link("/me/requests?new=1")}`,
    ].join("\n"),
  // Tin minh bạch gửi vào nhóm Zalo OA: ai làm gì, cho ai, lý do.
  GROUP_EVENT: (d) =>
    [
      `🔔 ${s(d.actorRole)} ${s(d.actorName)} ${s(d.action)}`,
      d.detail ? s(d.detail) : "",
      d.reason ? `Lý do: ${s(d.reason)}` : "",
      `🕒 ${s(d.atText)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  ABSENT_DIGEST: (d) => {
    const rows = (d.items as { name: string; code: string; note?: string }[]) ?? [];
    return [
      `📋 Tổng hợp vắng mặt — ca ${s(d.shiftName)} ngày ${s(d.dateText)} (${s(d.departmentName)})`,
      ...rows.map((r, i) => `${i + 1}. ${r.name} (${r.code})${r.note ? ` — ${r.note}` : ""}`),
      `Xem dashboard: ${link("/admin")}`,
    ].join("\n");
  },
};

export function renderMessage(type: MessageType, data: Data): string {
  return zaloTemplates[type](data);
}
