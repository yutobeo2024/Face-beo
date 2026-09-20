import { randomInt } from "node:crypto";

/**
 * Mật khẩu tạm ngẫu nhiên (6 chữ cái + 2 chữ số, bỏ ký tự dễ nhầm), dùng khi tạo tài khoản không kèm mật khẩu và khi đặt lại.
 * Không dùng mật khẩu mặc định chung: tài khoản mới có thể bị người khác đăng nhập và đổi mật khẩu trước chủ tài khoản.
 */
export function randomTempPassword() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const D = "23456789";
  const pick = (s: string) => s[randomInt(0, s.length)];
  return Array.from({ length: 6 }, () => pick(A)).join("") + pick(D) + pick(D);
}
