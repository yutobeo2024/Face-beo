import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { env } from "./env";

function bioKey(): Buffer {
  const k = Buffer.from(env.biometricKey, "hex");
  if (k.length !== 32) throw new Error("BIOMETRIC_KEY phải là 32 byte dạng hex (64 ký tự)");
  return k;
}

/** Mã hóa embedding bằng AES-256-GCM. Định dạng: iv(12) | tag(16) | ciphertext. */
export function encryptDescriptor(v: Float32Array | number[]): Uint8Array<ArrayBuffer> {
  const f = v instanceof Float32Array ? v : Float32Array.from(v);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", bioKey(), iv);
  const ct = Buffer.concat([c.update(Buffer.from(f.buffer, f.byteOffset, f.byteLength)), c.final()]);
  const out = Buffer.concat([iv, c.getAuthTag(), ct]);
  return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
}

export function decryptDescriptor(buf: Uint8Array): Float32Array {
  const b = Buffer.from(buf);
  const d = createDecipheriv("aes-256-gcm", bioKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  const pt = Buffer.concat([d.update(b.subarray(28)), d.final()]);
  const out = new Float32Array(pt.byteLength / 4);
  new Uint8Array(out.buffer).set(pt);
  return out;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomDigits(n: number): string {
  return Array.from({ length: n }, () => randomInt(0, 10)).join("");
}

const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomLinkCode(n = 6): string {
  return Array.from({ length: n }, () => LINK_ALPHABET[randomInt(0, LINK_ALPHABET.length)]).join("");
}
