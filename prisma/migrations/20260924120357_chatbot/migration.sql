-- v1.17.0 — Chat bot tra cứu y khoa trong Face Beo.
-- Dùng ALTER TABLE ADD COLUMN (không dựng lại bảng như Prisma tự sinh) để DB đang chạy không phải chép lại dữ liệu.

-- Ai được dùng: bật theo phòng, từng người có thể đặt khác (NULL = theo phòng).
ALTER TABLE "Department" ADD COLUMN "chatbotEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "chatbotEnabled" BOOLEAN;

-- Chỉ ĐẾM số lượt hỏi mỗi người mỗi ngày (chặn lạm dụng + thống kê). KHÔNG lưu câu hỏi / câu trả lời.
CREATE TABLE "ChatbotUsage" (
    "employeeId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("employeeId", "day")
);
CREATE INDEX "ChatbotUsage_day_idx" ON "ChatbotUsage"("day");

-- Quyền cấp phát chat bot: DB đang chạy không tự nạp quyền mới (ensureDefaultPermissions có chốt sentinel),
-- nên cấp sẵn cho Nhân sự ở đây. Quản trị luôn có mọi quyền. Muốn thu lại thì bỏ tích trong Phân quyền.
INSERT OR IGNORE INTO "RolePermission" ("role", "capability") VALUES ('HR', 'chatbot.grant');
