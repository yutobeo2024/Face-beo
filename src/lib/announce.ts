/**
 * Minh bạch: gửi thao tác quản trị (duyệt, sửa) của Nhân sự / Quản trị vào nhóm Zalo OA.
 * KHÔNG gửi: lần quét chấm công, và thao tác ngang quyền nhân viên (tự làm đơn, liên kết Zalo, xem công).
 * Không bao giờ ném lỗi — thông báo lỗi không được làm hỏng nghiệp vụ.
 */
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { TZ } from "./attendance";
import { getStringSetting } from "./settings";
import { sendZaloMessage } from "./zalo-oa";
import { isZaloSimulated } from "./zalo-token";
import { ROLE_LABEL, type Role } from "./roles";

type Actor = { id: number; name: string; role: Role | string };

/** Vai trò có thao tác phải công khai vào nhóm. */
export const ANNOUNCED_ROLES = new Set(["HR", "ADMIN"]);

export async function announce(
  actor: Actor,
  action: string,
  opts: { key: string; detail?: string; reason?: string | null; always?: boolean },
): Promise<void> {
  try {
    if (!opts.always && !ANNOUNCED_ROLES.has(actor.role)) return;
    const groupId = (await getStringSetting("zaloGroupId")).trim();
    if (!groupId && !isZaloSimulated()) {
      console.warn("[announce] chưa cấu hình ID nhóm Zalo (Cấu hình → Zalo) — bỏ qua:", action);
      return;
    }
    await sendZaloMessage({
      toGroupId: groupId || "chua-cau-hinh",
      messageType: "GROUP_EVENT",
      dedupeKey: `grp:${opts.key}`,
      data: {
        actorId: actor.id,
        actorRole: ROLE_LABEL[actor.role as Role] ?? actor.role,
        actorName: actor.name,
        action,
        detail: opts.detail,
        reason: opts.reason ?? undefined,
        atText: DateTime.now().setZone(TZ).toFormat("HH:mm dd/MM/yyyy"),
      },
    });
  } catch (e) {
    console.error("[announce] lỗi:", (e as Error).message);
  }
}

/** Khóa dedupe cho thao tác có thể lặp lại (sửa hồ sơ nhiều lần): gắn thời điểm. */
export const onceKey = (...parts: (string | number)[]) => `${parts.join(":")}:${randomUUID()}`;
