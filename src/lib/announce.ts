/**
 * Minh bạch: gửi thao tác quản trị (duyệt, sửa) của Nhân sự / Quản trị vào các nhóm Zalo nhận loại tin MINH_BACH.
 * KHÔNG gửi: lần quét chấm công, và thao tác ngang quyền nhân viên (tự làm đơn, liên kết Zalo, xem công).
 * Không bao giờ ném lỗi — thông báo lỗi không được làm hỏng nghiệp vụ.
 */
import { randomUUID } from "node:crypto";
import { sendZaloMessage, UNCONFIGURED_GROUP } from "./zalo-oa";
import { groupDedupeKey, groupsFor, nowText } from "./zalo-routing";
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
    // Chưa nhóm nào nhận tin minh bạch: vẫn ghi NotificationLog (FAILED ở chế độ thật) để Quản trị thấy trong Cấu hình → Zalo.
    const found = await groupsFor("MINH_BACH");
    const groups = found.length ? found : [UNCONFIGURED_GROUP];
    const data = {
      actorId: actor.id,
      actorRole: ROLE_LABEL[actor.role as Role] ?? actor.role,
      actorName: actor.name,
      action,
      detail: opts.detail,
      reason: opts.reason ?? undefined,
      atText: nowText(),
    };
    for (const groupId of groups) {
      const dedupeKey = await groupDedupeKey(`grp:${opts.key}`, groupId);
      if (dedupeKey) await sendZaloMessage({ toGroupId: groupId, messageType: "GROUP_EVENT", dedupeKey, data });
    }
  } catch (e) {
    console.error("[announce] lỗi:", (e as Error).message);
  }
}

/** Tin do hệ thống (job) gửi vào nhóm — không có người thao tác. */
export async function announceSystem(action: string, opts: { key: string; detail?: string }) {
  return announce({ id: 0, name: "Face Beo", role: "Hệ thống" }, action, { ...opts, always: true });
}

/** Khóa dedupe cho thao tác có thể lặp lại (sửa hồ sơ nhiều lần): gắn thời điểm. */
export const onceKey = (...parts: (string | number)[]) => `${parts.join(":")}:${randomUUID()}`;
