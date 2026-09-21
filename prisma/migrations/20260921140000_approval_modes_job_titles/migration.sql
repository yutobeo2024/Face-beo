-- CreateTable
CREATE TABLE "JobTitle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Department" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "managerId" INTEGER,
    "approvalMode" TEXT NOT NULL DEFAULT 'MANAGER_OR_HR',
    CONSTRAINT "Department_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Department" ("id", "managerId", "name") SELECT "id", "managerId", "name" FROM "Department";
DROP TABLE "Department";
ALTER TABLE "new_Department" RENAME TO "Department";
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
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
    "jobTitleId" INTEGER,
    "specialtyId" INTEGER,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "leftAt" DATETIME,
    "biometricConsentAt" DATETIME,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_defaultShiftId_fkey" FOREIGN KEY ("defaultShiftId") REFERENCES "Shift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_workPatternId_fkey" FOREIGN KEY ("workPatternId") REFERENCES "WorkPattern" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Employee_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Employee_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "leftAt", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "scheduleType", "sessionVersion", "workPatternId", "zaloLinkedAt", "zaloUserId") SELECT "active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "leftAt", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "scheduleType", "sessionVersion", "workPatternId", "zaloLinkedAt", "zaloUserId" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");
CREATE UNIQUE INDEX "Employee_zaloUserId_key" ON "Employee"("zaloUserId");
CREATE TABLE "new_LeaveRequest" (
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
    "managerApproverId" INTEGER,
    "managerDecidedAt" DATETIME,
    "managerNote" TEXT,
    "correctionAt" DATETIME,
    "correctionKind" TEXT,
    "executedById" INTEGER,
    "executedAt" DATETIME,
    "executedLogId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_managerApproverId_fkey" FOREIGN KEY ("managerApproverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeaveRequest" ("approverId", "correctionAt", "correctionKind", "createdAt", "decidedAt", "decisionNote", "employeeId", "executedAt", "executedById", "executedLogId", "fromTime", "id", "reason", "status", "toTime", "type") SELECT "approverId", "correctionAt", "correctionKind", "createdAt", "decidedAt", "decisionNote", "employeeId", "executedAt", "executedById", "executedLogId", "fromTime", "id", "reason", "status", "toTime", "type" FROM "LeaveRequest";
DROP TABLE "LeaveRequest";
ALTER TABLE "new_LeaveRequest" RENAME TO "LeaveRequest";
CREATE INDEX "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_name_key" ON "JobTitle"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_name_key" ON "Specialty"("name");

