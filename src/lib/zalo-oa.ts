/**
 * Dịch vụ Zalo OA (PRD mục 7). Xuất duy nhất `sendZaloMessage`, KHÔNG BAO GIỜ ném lỗi ra ngoài.
 * Thiếu bất kỳ biến ZALO_* nào => chế độ mô phỏng (in console + NotificationLog SIMULATED).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { renderMessage, type MessageType } from "./zalo-templates";
import { TokenInvalidError, getAccessToken, isZaloSimulated, refreshZaloToken, sleep, transport } from "./zalo-token";

type SendResult = { status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED_NO_ZALO" | "DUPLICATE" | "ERROR"; id?: number };

function printSimulated(to: { name: string; code: string; zaloUserId: string | null }, type: string, text: string) {
  const c = { cyan: "\x1b[36m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m" };
  const lines = text.split("\n");
  const w = Math.min(90, Math.max(40, ...lines.map((l) => l.length + 2)));
  const bar = "─".repeat(w);
  console.log(
    [
      `${c.cyan}┌${bar}┐${c.reset}`,
      `${c.cyan}│${c.reset} ${c.bold}[ZALO MÔ PHỎNG]${c.reset} ${c.yellow}${type}${c.reset}`,
      `${c.cyan}│${c.reset} ${c.dim}Tới:${c.reset} ${to.name} (${to.code}) ${c.dim}zalo=${to.zaloUserId ?? "chưa liên kết"}${c.reset}`,
      `${c.cyan}├${bar}┤${c.reset}`,
      ...lines.map((l) => `${c.cyan}│${c.reset} ${l}`),
      `${c.cyan}└${bar}┘${c.reset}`,
    ].join("\n"),
  );
}

export async function sendZaloMessage(args: {
  toEmployeeId: number;
  messageType: MessageType;
  data: Record<string, unknown>;
  dedupeKey: string;
}): Promise<SendResult> {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: args.toEmployeeId },
      select: { id: true, name: true, code: true, zaloUserId: true },
    });
    if (!emp) return { status: "ERROR" };
    const text = renderMessage(args.messageType, args.data);
    let logId: number;
    try {
      const row = await prisma.notificationLog.create({
        data: {
          dedupeKey: args.dedupeKey,
          toEmployeeId: emp.id,
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

    if (isZaloSimulated()) {
      printSimulated(emp, args.messageType, text);
      return finish(emp.zaloUserId ? "SIMULATED" : "SKIPPED_NO_ZALO");
    }
    if (!emp.zaloUserId) return finish("SKIPPED_NO_ZALO");

    let lastErr = "";
    let refreshed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const accessToken = await getAccessToken();
        await transport({ zaloUserId: emp.zaloUserId, text, accessToken });
        return finish("SENT");
      } catch (e) {
        lastErr = (e as Error).message;
        if (e instanceof TokenInvalidError && !refreshed) {
          refreshed = true;
          try {
            const accessToken = await refreshZaloToken(true);
            await transport({ zaloUserId: emp.zaloUserId, text, accessToken });
            return finish("SENT");
          } catch (e2) {
            lastErr = (e2 as Error).message;
          }
        }
        if (attempt < 2) await sleep(500 * 2 ** attempt);
      }
    }
    return finish("FAILED", lastErr.slice(0, 500));
  } catch (e) {
    console.error("[zalo] sendZaloMessage lỗi:", (e as Error).message);
    return { status: "ERROR" };
  }
}
