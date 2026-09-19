import { Badge, type Tone } from "./ui";

export const DAY_STATUS: Record<string, { label: string; tone: Tone }> = {
  ON_TIME: { label: "Đúng giờ", tone: "ontime" },
  LATE: { label: "Đi trễ", tone: "late" },
  ABSENT: { label: "Vắng mặt", tone: "absent" },
  ON_LEAVE: { label: "Nghỉ có phép", tone: "leave" },
  NOT_YET: { label: "Chưa đến ca", tone: "neutral" },
  DAY_OFF: { label: "Nghỉ", tone: "neutral" },
  HOLIDAY: { label: "Ngày lễ", tone: "violet" },
  OUT_OF_SHIFT: { label: "Ngoài ca", tone: "violet" },
};

export function DayStatusBadge({ status }: { status: string }) {
  const s = DAY_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const REQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Chờ duyệt", tone: "late" },
  APPROVED: { label: "Đã duyệt", tone: "ontime" },
  REJECTED: { label: "Từ chối", tone: "absent" },
  CANCELLED: { label: "Đã hủy", tone: "neutral" },
};

export const REQ_TYPE: Record<string, { label: string; tone: Tone; emoji: string }> = {
  NGHI_PHEP: { label: "Nghỉ phép", tone: "leave", emoji: "🌴" },
  VE_SOM: { label: "Về sớm", tone: "late", emoji: "🏃" },
  TANG_CA_OT: { label: "Tăng ca (OT)", tone: "violet", emoji: "⏱️" },
  BO_SUNG_CONG: { label: "Bổ sung công", tone: "brand", emoji: "🛠️" },
};

/** Trạng thái bước 2 của đơn bổ sung công (sau khi duyệt). */
export function CorrectionBadge({ r }: { r: { type: string; status: string; executedAt?: string | null } }) {
  if (r.type !== "BO_SUNG_CONG" || r.status !== "APPROVED") return null;
  return r.executedAt ? <Badge tone="ontime">Đã chấm tay</Badge> : <Badge tone="late">Chờ Nhân sự chấm tay</Badge>;
}

export function ReqStatusBadge({ status }: { status: string }) {
  const s = REQ_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
