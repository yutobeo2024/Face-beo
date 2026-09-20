-- Thu hồi phiên: JWT mang sessionVersion lúc phát hành; đổi/đặt lại mật khẩu, đăng xuất tăng số này => phiên cũ hết hiệu lực.
ALTER TABLE "Employee" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
