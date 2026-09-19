/** Mẫu nội dung tin Zalo OA (PRD mục 7). Mỗi loại một hàm nhận data, trả chuỗi tiếng Việt kèm link. */
import { env } from "./env";

export type MessageType =
  | "REQUEST_CREATED"
  | "REQUEST_DECIDED"
  | "LATE_REMINDER"
  | "ABSENT_WARNING"
  | "ABSENT_DIGEST"
  | "GROUP_EVENT"
  | "CORRECTION_READY"
  | "CORRECTION_DONE"
  | "MISSING_OUT_NUDGE"
  | "ROSTER_REMINDER"
  | "ROSTER_UNREGISTERED"
  | "REQUEST_OVERDUE"
  | "REQUEST_ESCALATED";

const link = (path: string) => `${env.appBaseUrl.replace(/\/$/, "")}${path}`;

type Data = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export const zaloTemplates: Record<MessageType, (d: Data) => string> = {
  REQUEST_CREATED: (d) =>
    [
      d.fyi ? `📝 Đơn bổ sung công mới (chờ quản lý duyệt — bạn sẽ chấm tay sau khi duyệt)` : `📝 Đơn mới cần duyệt`,
      `${s(d.employeeName)} (${s(d.employeeCode)}) gửi đơn ${s(d.typeLabel)}.`,
      d.correctionText ? `Cần bổ sung ${s(d.correctionText)}` : `Thời gian: ${s(d.fromText)} → ${s(d.toText)}`,
      `Lý do: ${s(d.reason)}`,
      d.fyi ? `Theo dõi tại: ${link("/admin/requests?status=PENDING")}` : `Duyệt tại: ${link("/admin/requests?status=PENDING")}`,
    ].join("\n"),
  REQUEST_DECIDED: (d) =>
    [
      d.status === "APPROVED" ? `✅ Đơn của bạn đã được duyệt` : `❌ Đơn của bạn bị từ chối`,
      d.correctionText ? `Loại: ${s(d.typeLabel)} — ${s(d.correctionText)}` : `Loại: ${s(d.typeLabel)} (${s(d.fromText)} → ${s(d.toText)})`,
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
  CORRECTION_READY: (d) =>
    [
      `🛠️ Đơn bổ sung công #${s(d.requestId)} đã được duyệt — chờ chấm tay`,
      `${s(d.employeeName)} (${s(d.employeeCode)}) cần bổ sung ${s(d.correctionText)}.`,
      `Lý do: ${s(d.reason)}`,
      `Thực hiện tại: ${link("/admin/requests?view=execute")}`,
    ].join("\n"),
  CORRECTION_DONE: (d) =>
    [
      `✅ Đã bổ sung ${s(d.kindText)} lúc ${s(d.timeText)} theo đơn #${s(d.requestId)}`,
      `Người thực hiện: ${s(d.executorName)}`,
      `Xem công: ${link("/me/attendance")}`,
    ].join("\n"),
  MISSING_OUT_NUDGE: (d) =>
    [
      `🔔 Thiếu giờ ra ngày ${s(d.dateText)}`,
      `Hệ thống chỉ ghi nhận giờ vào lúc ${s(d.inText)} (ca ${s(d.shiftName)}).`,
      `Nếu bạn quên chấm ra, hãy tạo đơn bổ sung công: ${link(`/me/requests?new=1&type=BO_SUNG_CONG&date=${s(d.date)}`)}`,
    ].join("\n"),
  ROSTER_REMINDER: (d) =>
    [
      `🗓️ Nhắc đăng ký ca tuần ${s(d.weekText)}`,
      `Phòng ${s(d.departmentName)} có ${s(d.rotatingCount)} nhân viên xoay ca nhưng chưa đăng ký lịch tuần tới.`,
      `Hạn chót: trước 00:00 thứ Hai. Sau hạn chỉ Nhân sự đăng ký được.`,
      `Xếp ca tại: ${link(`/admin/roster?week=${s(d.week)}`)}`,
    ].join("\n"),
  ROSTER_UNREGISTERED: (d) =>
    [
      `⚠️ Tuần ${s(d.weekText)} còn ${s(d.count)} phòng chưa đăng ký ca`,
      s(d.list),
      `Nhân viên xoay ca của các phòng này đang ở trạng thái "Chưa có lịch" (không tính trễ/vắng).`,
      `Đăng ký tại: ${link(`/admin/roster?week=${s(d.week)}`)}`,
    ].join("\n"),
  REQUEST_OVERDUE: (d) =>
    [
      `⏰ Đơn #${s(d.requestId)} đang chờ bạn ${s(d.stage)} đã quá ${s(d.hours)} giờ`,
      `${s(d.employeeName)} (${s(d.employeeCode)}) — ${s(d.typeLabel)}: ${s(d.timeText)}`,
      `Xử lý tại: ${link(d.stage === "chấm tay" ? "/admin/requests?view=execute" : "/admin/requests?status=PENDING")}`,
    ].join("\n"),
  REQUEST_ESCALATED: (d) =>
    [
      `🚨 Đơn #${s(d.requestId)} chờ ${s(d.stage)} đã quá ${s(d.hours)} giờ — cần Quản trị xem xét`,
      `${s(d.employeeName)} (${s(d.employeeCode)}) — ${s(d.typeLabel)}: ${s(d.timeText)}`,
      `Người phải xử lý: ${s(d.handlers) || "(không có)"}`,
      `Xem tại: ${link("/admin/requests")}`,
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
