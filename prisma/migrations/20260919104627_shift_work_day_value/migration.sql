-- CreateTable
CREATE TABLE "DepartmentShiftWeight" (
    "departmentId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "workDayValue" REAL NOT NULL,

    PRIMARY KEY ("departmentId", "shiftId")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shift" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "graceLateMinutes" INTEGER NOT NULL DEFAULT 5,
    "graceEarlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakStart" TEXT,
    "workDayValue" REAL NOT NULL DEFAULT 1
);
INSERT INTO "new_Shift" ("breakMinutes", "endTime", "graceEarlyMinutes", "graceLateMinutes", "id", "name", "startTime") SELECT "breakMinutes", "endTime", "graceEarlyMinutes", "graceLateMinutes", "id", "name", "startTime" FROM "Shift";
DROP TABLE "Shift";
ALTER TABLE "new_Shift" RENAME TO "Shift";
CREATE UNIQUE INDEX "Shift_name_key" ON "Shift"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Dữ liệu: ca ban ngày có giờ nghỉ và chứa trọn khung nghỉ từ 12:00 => giờ bắt đầu nghỉ 12:00 (D1).
-- Hệ số công giữ = 1 cho mọi ca; Quản trị tự cấu hình sau.
UPDATE "Shift" SET "breakStart" = '12:00'
WHERE "breakMinutes" > 0
  AND "endTime" > "startTime"
  AND "startTime" <= '12:00'
  AND strftime('%H:%M', '2000-01-01 12:00', '+' || "breakMinutes" || ' minutes') <= "endTime";
