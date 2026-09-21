import { prisma } from "@/lib/db";
import { badRequest, handle, idParam, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadCredentialTarget } from "@/lib/credential-access";
import { MAX_CREDENTIAL_FILE_BYTES, deleteCredentialFile, readCredentialFile, saveCredentialFile } from "@/lib/credential-files";

type P = { id: string; cid: string };

/** Tên file gốc (chỉ để hiển thị): giải mã an toàn, bỏ ký tự điều khiển / dấu gạch thư mục, ≤ 120 ký tự. */
function fileNameHeader(v: string | null) {
  let name = v ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    /* giữ nguyên chuỗi chưa giải mã */
  }
  // Cắt theo ký tự (không cắt đôi emoji / cặp surrogate).
  return Array.from(name.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim()).slice(0, 120).join("");
}

async function load(employeeId: number, cid: string) {
  const id = Number(cid);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("id không hợp lệ");
  const c = await prisma.credential.findUnique({ where: { id } });
  if (!c || c.employeeId !== employeeId) throw notFound();
  return c;
}

/** Xem / tải file scan — Nhân sự, Quản trị và chính chủ. */
export const GET = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "read");
  const c = await load(e.id, (await ctx.params).cid);
  if (!c.fileKey) throw notFound("Chưa có file");
  const buf = await readCredentialFile(e.id, c.fileKey);
  if (!buf) throw notFound("Không tìm thấy file");
  const name = encodeURIComponent(c.fileName ?? `chung-chi-${c.id}`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": c.fileMime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // PDF mở trực tiếp trong trình duyệt: cô lập, không chạy script dưới tên miền ứng dụng.
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
});

/** Tải lên / thay file (thân = file thô, tên gốc gửi qua header x-file-name). PDF / JPG / PNG, ≤ 10 MB. */
export const POST = handle<P>(async (req, ctx) => {
  const u = await requireUser(req);
  const e = await loadCredentialTarget(u, await idParam(ctx), "write");
  const c = await load(e.id, (await ctx.params).cid);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CREDENTIAL_FILE_BYTES) throw badRequest("File quá lớn (tối đa 10 MB)");
  const rawName = fileNameHeader(req.headers.get("x-file-name"));
  const saved = await saveCredentialFile(e.id, new Uint8Array(await req.arrayBuffer()));
  try {
    await prisma.credential.update({ where: { id: c.id }, data: { fileKey: saved.key, fileName: rawName || `tep.${saved.key.split(".").pop()}`, fileMime: saved.mime, fileSize: saved.size } });
  } catch (err) {
    await deleteCredentialFile(e.id, saved.key); // không để file mồ côi
    throw err;
  }
  await deleteCredentialFile(e.id, c.fileKey); // file cũ (nếu thay)
  await audit({ actorId: u.id, action: "CREDENTIAL_UPDATE", entity: "Credential", entityId: c.id, detail: { employeeId: e.id, file: true, size: saved.size } });
  return json({ ok: true, fileSize: saved.size });
});
