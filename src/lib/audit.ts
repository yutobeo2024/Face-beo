import { prisma } from "./db";

export type AuditAction =
  | "REQUEST_APPROVE"
  | "REQUEST_REJECT"
  | "ATTENDANCE_MANUAL"
  | "ATTENDANCE_DELETE"
  | "FACE_ENROLL"
  | "FACE_DELETE"
  | "FACE_DUPLICATE_WARNING"
  | "CONSENT_GIVEN"
  | "CONSENT_WITHDRAWN"
  | "DEVICE_CREATE"
  | "DEVICE_PAIR"
  | "DEVICE_REVOKE"
  | "SETTINGS_UPDATE"
  | "PERMISSION_CHANGE"
  | "CORRECTION_EXECUTE"
  | "ROSTER_REGISTER"
  | "ROSTER_CHANGE"
  | "PATTERN_UPDATE"
  | "SHIFT_UPDATE"
  | "SHIFT_WEIGHT_UPDATE"
  | "FACE_MODEL_ERROR"
  | "KIOSK_OUTDATED"
  | "ZALO_GROUP_DISCOVERED"
  | "ZALO_GROUP_ROUTING"
  | "PAYROLL_LOCK"
  | "PAYROLL_UNLOCK"
  | "HOLIDAY_UPDATE"
  | "INFOLINK_UPDATE"
  | "EMPLOYEE_CREATE"
  | "EMPLOYEE_UPDATE"
  | "EMPLOYEE_DELETE"
  | "PASSWORD_RESET"
  | "SCAN_SPOOF_REJECTED"
  | "SCAN_NO_MATCH"
  | "LIVENESS_L2_UNAVAILABLE"
  | "MISSING_CHECKOUT"
  | "ZALO_TOKEN_REFRESH_FAILED";

export async function audit(args: {
  actorId?: number | null;
  action: AuditAction;
  entity: string;
  entityId?: string | number | null;
  detail?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: args.actorId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId == null ? null : String(args.entityId),
        detail: args.detail === undefined ? null : JSON.stringify(args.detail),
      },
    });
  } catch (e) {
    console.error("[audit] ghi thất bại:", (e as Error).message);
  }
}
