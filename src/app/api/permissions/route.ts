import { z } from "zod";
import { handle, json, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { announce } from "@/lib/announce";
import {
  CAPABILITIES,
  DEFAULT_MATRIX,
  EDITABLE_ROLES,
  capLabel,
  getMatrix,
  requirePerm,
  saveMatrix,
  validateMatrix,
} from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/roles";

/** Ma trận phân quyền hiện tại + danh mục quyền (chỉ người có `permissions.manage` — Quản trị). */
export const GET = handle(async (req) => {
  await requirePerm(req, "permissions.manage");
  const m = await getMatrix();
  return json({
    capabilities: CAPABILITIES,
    roles: EDITABLE_ROLES,
    matrix: Object.fromEntries(EDITABLE_ROLES.map((r) => [r, [...m[r]]])),
    defaults: DEFAULT_MATRIX,
  });
});

const putSchema = z.object({
  matrix: z.record(z.string(), z.array(z.string())),
  reason: z.string().trim().min(5, "lý do tối thiểu 5 ký tự").max(300),
});

export const PUT = handle(async (req) => {
  const u = await requirePerm(req, "permissions.manage");
  const body = await parseJson(req, putSchema);
  const next = validateMatrix(body.matrix);
  const diff = await saveMatrix(next);
  if (diff.length) {
    await audit({ actorId: u.id, action: "PERMISSION_CHANGE", entity: "RolePermission", detail: { diff, reason: body.reason } });
    const lines = diff.map(
      (d) =>
        `${ROLE_LABEL[d.role as keyof typeof ROLE_LABEL] ?? d.role}: ` +
        [...d.added.map((c) => `+ ${capLabel(c)}`), ...d.removed.map((c) => `− ${capLabel(c)}`)].join("; "),
    );
    await announce(u, "đã thay đổi phân quyền", { key: `perm:${Date.now()}`, detail: lines.join("\n"), reason: body.reason, always: true });
  }
  return json({ ok: true, diff });
});
