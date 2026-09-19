-- CreateTable
CREATE TABLE "ScheduleAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "defaultShiftId" INTEGER NOT NULL,
    "workPatternId" INTEGER,
    "monShiftId" INTEGER,
    "tueShiftId" INTEGER,
    "wedShiftId" INTEGER,
    "thuShiftId" INTEGER,
    "friShiftId" INTEGER,
    "satShiftId" INTEGER,
    "sunShiftId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAssignment_employeeId_effectiveFrom_key" ON "ScheduleAssignment"("employeeId", "effectiveFrom");

-- Dữ liệu: bản ghi gốc cho mọi nhân viên (áp dụng từ quá khứ) theo cấu hình hiện tại.
INSERT INTO "ScheduleAssignment" ("employeeId", "effectiveFrom", "scheduleType", "departmentId", "defaultShiftId", "workPatternId",
  "monShiftId", "tueShiftId", "wedShiftId", "thuShiftId", "friShiftId", "satShiftId", "sunShiftId")
SELECT e."id", '2000-01-01', e."scheduleType", e."departmentId", e."defaultShiftId", e."workPatternId",
  p."monShiftId", p."tueShiftId", p."wedShiftId", p."thuShiftId", p."friShiftId", p."satShiftId", p."sunShiftId"
FROM "Employee" e LEFT JOIN "WorkPattern" p ON p."id" = e."workPatternId";

-- Dữ liệu: giữ nguyên kết quả cũ cho phòng có nhân viên xoay ca — trước đây mọi tuần (kể cả tuần không có lịch
-- riêng => ca mặc định) đều có hiệu lực, nên đánh dấu REGISTERED mọi tuần từ ngày công sớm nhất đến tuần hiện tại.
WITH RECURSIVE
  bounds AS (
    SELECT date(MIN(d), '-6 days', 'weekday 1') AS lo, date(date('now', '+7 hours'), '-6 days', 'weekday 1') AS hi
    FROM (SELECT MIN("workDate") AS d FROM "AttendanceLog" UNION ALL SELECT MIN("date") FROM "WorkSchedule")
  ),
  weeks(w) AS (
    SELECT lo FROM bounds WHERE lo IS NOT NULL
    UNION ALL SELECT date(w, '+7 days') FROM weeks, bounds WHERE w < bounds.hi
  ),
  depts AS (SELECT DISTINCT "departmentId" AS id FROM "Employee" WHERE "scheduleType" = 'ROTATING')
INSERT OR IGNORE INTO "RosterWeek" ("departmentId", "weekStart", "status", "registeredAt", "updatedAt")
SELECT depts.id, weeks.w, 'REGISTERED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM depts, weeks;
