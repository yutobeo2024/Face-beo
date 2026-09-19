/**
 * Dịch vụ Zalo OA (PRD mục 7). Xuất duy nhất `sendZaloMessage`, KHÔNG BAO GIỜ ném lỗi ra ngoài.
 * Người nhận: một nhân viên (`toEmployeeId`, tra `zaloUserId`) hoặc một nhóm GMF của OA (`toGroupId`).
 * Thiếu bất kỳ biến ZALO_* nào => chế độ mô phỏng (in console + NotificationLog SIMULATED).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { renderMessage, type MessageType } from "./zalo-templates";
import { TokenInvalidError, getAccessToken, groupTransport, isZaloSimulated, refreshZaloToken, sleep, transport, ZaloApiError } from "./zalo-token";

/** Giá trị giữ chỗ khi Quản trị chưa nhập ID nhóm — ở chế độ thật sẽ ghi FAILED với lý do rõ ràng. */
export const UNCONFIGURED_GROUP = "chua-cau-hinh";

type SendResult = { status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED_NO_ZALO" | "DUPLICATE" | "ERROR"; id?: number; error?: string };

function printSimulated(to: string, type: string, text: string) {
  const c = { cyan: "\x1b[36m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m" };
  const lines = text.split("\n");
  const w = Math.min(90, Math.max(40, ...lines.map((l) => l.length + 2)));
  const bar = "─".repeat(w);
  console.log(
    [
      `${c.cyan}┌${bar}┐${c.reset}`,
      `${c.cyan}│${c.reset} ${c.bold}[ZALO MÔ PHỎNG]${c.reset} ${c.yellow}${type}${c.reset}`,
      `${c.cyan}│${c.reset} ${c.dim}Tới:${c.reset} ${to}`,
      `${c.cyan}├${bar}┤${c.reset}`,
      ...lines.map((l) => `${c.cyan}│${c.reset} ${l}`),
      `${c.cyan}└${bar}┘${c.reset}`,
    ].join("\n"),
  );
}

export async function sendZaloMessage(args: {
  toEmployeeId?: number;
  toGroupId?: string;
  messageType: MessageType;
  data: Record<string, unknown>;
  dedupeKey: string;
}): Promise<SendResult> {
  try {
    const isGroup = !args.toEmployeeId && !!args.toGroupId;
    const emp = args.toEmployeeId
      ? await prisma.employee.findUnique({ where: { id: args.toEmployeeId }, select: { id: true, name: true, code: true, zaloUserId: true } })
      : null;
    if (!emp && !isGroup) return { status: "ERROR" };
    const text = renderMessage(args.messageType, args.data);
    let logId = 0;
    try {
      const row = await prisma.notificationLog.create({
        data: {
          dedupeKey: args.dedupeKey,
          toEmployeeId: emp?.id ?? null,
          toGroupId: isGroup ? args.toGroupId! : null,
          messageType: args.messageType,
          payload: JSON.stringify({ ...args.data, text }),
          status: "PENDING",
        },
      });
      logId = row.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "DUPLICATE" };
      throw e;
    }
    const finish = async (status: SendResult["status"], error?: string) => {
      await prisma.notificationLog.update({ where: { id: logId }, data: { status, error: error ?? null } });
      return { status, id: logId };
    };

    const target = isGroup ? `nhóm ${args.toGroupId}` : `${emp!.name} (${emp!.code}) zalo=${emp!.zaloUserId ?? "chưa liên kết"}`;
    if (isZaloSimulated()) {
      printSimulated(target, args.messageType, text);
      return finish(isGroup || emp!.zaloUserId ? "SIMULATED" : "SKIPPED_NO_ZALO");
    }
    if (!isGroup && !emp!.zaloUserId) return finish("SKIPPED_NO_ZALO");
    if (isGroup && args.toGroupId === UNCONFIGURED_GROUP) return finish("FAILED", "Chưa cấu hình ID nhóm Zalo (Cấu hình → Zalo)");

    const deliver = (accessToken: string) =>
      isGroup ? groupTransport({ groupId: args.toGroupId!, text, accessToken }) : transport({ zaloUserId: emp!.zaloUserId!, text, accessToken });

    let lastErr = "";
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await deliver(await getAccessToken());
        return finish("SENT");
      } catch (e) {
        lastErr = (e as Error).message;
        if (e instanceof TokenInvalidError && !refreshed) {
          refreshed = true;
          try {
            await deliver(await refreshZaloToken(true));
            return finish("SENT");
          } catch (e2) {
            lastErr = (e2 as Error).message;
          }
        }
        // Lỗi cấu hình / dữ liệu (sai group_id, app chưa được cấp quyền…): thử lại vô ích.
        if (e instanceof ZaloApiError && !e.retryable) break;
        if (attempt < 2) await sleep(e instanceof ZaloApiError ? 2000 : 500 * 2 ** attempt);
      }
    }
    return finish("FAILED", lastErr.slice(0, 500));
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[zalo] sendZaloMessage lỗi:", msg);
    return { status: "ERROR", error: msg };
  }
}
