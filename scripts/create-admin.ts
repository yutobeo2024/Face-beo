/**
 * Tạo tài khoản Quản trị đầu tiên trên DB chưa có Quản trị (vận hành thật, không cần seed dữ liệu mẫu),
 * hoặc cấp lại mật khẩu tạm cho một Quản trị (quên mật khẩu / bị khóa đăng nhập).
 *
 *   npm run admin:create -- --code AD01 --name "Nguyễn Văn A" --phone 0901234567 [--dept "Ban quản trị"] [--shift "Hành chính"] [--password ...]
 *   npm run admin:create -- --reset AD01 [--password ...]
 *
 * Mật khẩu (tự sinh nếu không truyền --password) chỉ in một lần ra màn hình; bắt buộc đổi ở lần đăng nhập đầu.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

// Giống prisma.config.ts: nạp .env nhưng không ghi đè biến đã có (vd. DATABASE_URL truyền từ ngoài).
if (existsSync(".env")) process.loadEnvFile(".env");

const USAGE = `
Cách dùng:
  npm run admin:create -- --code AD01 --name "Nguyễn Văn A" --phone 0901234567
      [--dept "Ban quản trị"]   phòng ban (chưa có thì tạo mới)
      [--shift "Hành chính"]    ca mặc định (cần chạy npm run db:seed:base trước)
      [--password Matkhau123]   tự đặt mật khẩu (≥ 8 ký tự, có chữ và số). Nên bỏ trống để hệ thống sinh mật khẩu tạm:
                                npm in lại cả dòng lệnh và lịch sử shell lưu mật khẩu gõ ở đây
  npm run admin:create -- --reset AD01 [--password ...]   cấp lại mật khẩu cho Quản trị AD01
`;

async function run() {
  const { values } = parseArgs({
    options: {
      code: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
      dept: { type: "string" },
      shift: { type: "string" },
      password: { type: "string" },
      reset: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.reset !== undefined) {
    if (!values.reset.trim()) return fail("Thiếu mã Quản trị sau --reset.");
    if (values.code || values.name || values.phone || values.dept || values.shift) return fail("--reset chỉ đi kèm --password, không dùng cùng --code/--name/--phone/--dept/--shift.");
  } else if (!values.code || !values.name || !values.phone) return fail("Thiếu --code, --name hoặc --phone.");

  const { PrismaClient } = await import("@prisma/client");
  const { BootstrapError, createFirstAdmin, resetAdminPassword } = await import("../src/lib/bootstrap");
  const db = new PrismaClient();
  try {
    await db.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    if (values.reset) {
      const { employee, password } = await resetAdminPassword(db, values.reset, values.password);
      console.log(`\n✅ Đã cấp lại mật khẩu cho Quản trị ${employee.code} — ${employee.name}. Mọi phiên đăng nhập cũ đã bị thu hồi.`);
      printPassword(employee.code, employee.phone, password);
    } else {
      const { employee, password } = await createFirstAdmin(db, {
        code: values.code!,
        name: values.name!,
        phone: values.phone!,
        department: values.dept,
        shift: values.shift,
        password: values.password,
      });
      console.log(`\n✅ Đã tạo Quản trị ${employee.code} — ${employee.name} (phòng "${employee.departmentName}", ca "${employee.shiftName}").`);
      printPassword(employee.code, employee.phone, password);
      console.log("Tiếp theo: vào Cài đặt kiểm tra ca/hệ số công, tạo phòng ban và nhân viên.\n");
    }
  } catch (e) {
    if (e instanceof BootstrapError) {
      console.error(`\n⛔ ${e.message}\n`);
      process.exitCode = 1;
    } else throw e;
  } finally {
    await db.$disconnect();
  }
}

function fail(message: string) {
  console.error(`⛔ ${message}${USAGE}`);
  process.exitCode = 1;
}

function printPassword(code: string, phone: string, password: string) {
  console.log(`   Đăng nhập bằng mã ${code} hoặc SĐT ${phone}, mật khẩu: ${password}`);
  console.log("   Mật khẩu chỉ hiện một lần — hệ thống sẽ bắt đổi ở lần đăng nhập đầu.\n");
}

run().catch((e) => {
  if (e instanceof TypeError && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS")) fail(`Tham số không hợp lệ (${e.message}).`);
  else {
    console.error(e);
    process.exitCode = 1;
  }
});
