-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "leftAt" DATETIME;

-- AlterTable
ALTER TABLE "LockedDay" ADD COLUMN "departmentId" INTEGER;

-- Dữ liệu: nhân viên đã nghỉ việc => ngày nghỉ việc lấy theo lần chấm công cuối (không có thì ngày tạo tài khoản).
UPDATE "Employee" SET "leftAt" = COALESCE((SELECT MAX(l."checkTime") FROM "AttendanceLog" l WHERE l."employeeId" = "Employee"."id"), "createdAt")
WHERE "active" = 0 AND "leftAt" IS NULL;
