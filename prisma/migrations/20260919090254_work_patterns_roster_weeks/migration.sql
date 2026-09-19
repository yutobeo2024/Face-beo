-- CreateTable
CREATE TABLE "WorkPattern" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "monShiftId" INTEGER,
    "tueShiftId" INTEGER,
    "wedShiftId" INTEGER,
    "thuShiftId" INTEGER,
    "friShiftId" INTEGER,
    "satShiftId" INTEGER,
    "sunShiftId" INTEGER
);

-- CreateTable
CREATE TABLE "RosterWeek" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "departmentId" INTEGER NOT NULL,
    "weekStart" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "registeredById" INTEGER,
    "registeredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "zaloUserId" TEXT,
    "zaloLinkedAt" DATETIME,
    "departmentId" INTEGER NOT NULL,
    "defaultShiftId" INTEGER NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'FIXED',
    "workPatternId" INTEGER,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "biometricConsentAt" DATETIME,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_defaultShiftId_fkey" FOREIGN KEY ("defaultShiftId") REFERENCES "Shift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_workPatternId_fkey" FOREIGN KEY ("workPatternId") REFERENCES "WorkPattern" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "zaloLinkedAt", "zaloUserId") SELECT "active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "zaloLinkedAt", "zaloUserId" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");
CREATE UNIQUE INDEX "Employee_zaloUserId_key" ON "Employee"("zaloUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WorkPattern_name_key" ON "WorkPattern"("name");

-- CreateIndex
CREATE INDEX "RosterWeek_weekStart_idx" ON "RosterWeek"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "RosterWeek_departmentId_weekStart_key" ON "RosterWeek"("departmentId", "weekStart");

-- ---------------------------------------------------------------------------
-- Chuyển đổi dữ liệu v1 → v1.1: GIỮ NGUYÊN kết quả chấm công hiện có.
-- ---------------------------------------------------------------------------
-- 1) Nhân viên đang có lịch riêng => nhóm xoay ca.
UPDATE "Employee" SET "scheduleType" = 'ROTATING' WHERE "id" IN (SELECT DISTINCT "employeeId" FROM "WorkSchedule");

-- 2) Nhân viên cố định: mẫu tuần T2–T7 theo đúng ca mặc định (hành vi cũ: làm T2–T7, nghỉ Chủ nhật và ngày lễ).
INSERT INTO "WorkPattern" ("name", "monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId")
SELECT 'T2–T7 · ' || s."name", s."id", s."id", s."id", s."id", s."id", s."id", NULL
FROM "Shift" s
WHERE s."id" IN (SELECT DISTINCT "defaultShiftId" FROM "Employee" WHERE "scheduleType" = 'FIXED');

UPDATE "Employee"
SET "workPatternId" = (
  SELECT wp."id" FROM "WorkPattern" wp
  WHERE wp."name" = 'T2–T7 · ' || (SELECT s."name" FROM "Shift" s WHERE s."id" = "Employee"."defaultShiftId")
)
WHERE "scheduleType" = 'FIXED';

-- 3) Mọi (phòng ban, tuần) đang có lịch => coi như đã đăng ký.
INSERT INTO "RosterWeek" ("departmentId", "weekStart", "status", "registeredAt", "updatedAt")
SELECT DISTINCT e."departmentId", date(ws."date", '-6 days', 'weekday 1'), 'REGISTERED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WorkSchedule" ws
JOIN "Employee" e ON e."id" = ws."employeeId";
