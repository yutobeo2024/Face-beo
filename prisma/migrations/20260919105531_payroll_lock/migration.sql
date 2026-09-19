-- CreateTable
CREATE TABLE "PayrollLock" (
    "month" TEXT NOT NULL PRIMARY KEY,
    "lockedById" INTEGER NOT NULL,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totals" TEXT
);

-- CreateTable
CREATE TABLE "LockedDay" (
    "employeeId" INTEGER NOT NULL,
    "workDate" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    PRIMARY KEY ("employeeId", "workDate")
);

-- CreateIndex
CREATE INDEX "LockedDay_month_idx" ON "LockedDay"("month");

-- Dữ liệu: ma trận quyền đã khởi tạo không tự nạp lại mặc định => cấp sẵn quyền chốt công cho Nhân sự.
INSERT OR IGNORE INTO "RolePermission" ("role", "capability")
SELECT 'HR', 'payroll.lock' WHERE EXISTS (SELECT 1 FROM "RolePermission" WHERE "role" = '_meta' AND "capability" = 'initialized');
