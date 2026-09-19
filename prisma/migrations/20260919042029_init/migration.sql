-- CreateTable
CREATE TABLE "Department" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "managerId" INTEGER,
    CONSTRAINT "Department_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
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
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "biometricConsentAt" DATETIME,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_defaultShiftId_fkey" FOREIGN KEY ("defaultShiftId") REFERENCES "Shift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "graceLateMinutes" INTEGER NOT NULL DEFAULT 5,
    "graceEarlyMinutes" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "shiftId" INTEGER,
    "isDayOff" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkSchedule_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holiday" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FaceTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "descriptor" BLOB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaceTemplate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tokenHash" TEXT,
    "pairCode" TEXT,
    "pairExpiresAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" DATETIME
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "workDate" TEXT NOT NULL,
    "shiftId" INTEGER,
    "checkTime" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "isEarly" BOOLEAN NOT NULL DEFAULT false,
    "earlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "excusedByRequestId" INTEGER,
    "snapshotUrl" TEXT,
    "verified3D" BOOLEAN NOT NULL DEFAULT false,
    "livenessScore" REAL,
    "matchScore" REAL,
    "source" TEXT NOT NULL DEFAULT 'KIOSK',
    "deviceId" INTEGER,
    "clientEventId" TEXT,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceLog_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AttendanceLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fromTime" DATETIME NOT NULL,
    "toTime" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" INTEGER,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dedupeKey" TEXT NOT NULL,
    "toEmployeeId" INTEGER NOT NULL,
    "messageType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZaloToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ZaloLinkCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_zaloUserId_key" ON "Employee"("zaloUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_name_key" ON "Shift"("name");

-- CreateIndex
CREATE INDEX "WorkSchedule_date_idx" ON "WorkSchedule"("date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_employeeId_date_key" ON "WorkSchedule"("employeeId", "date");

-- CreateIndex
CREATE INDEX "FaceTemplate_employeeId_idx" ON "FaceTemplate"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_clientEventId_key" ON "AttendanceLog"("clientEventId");

-- CreateIndex
CREATE INDEX "AttendanceLog_employeeId_workDate_idx" ON "AttendanceLog"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceLog_workDate_idx" ON "AttendanceLog"("workDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");
