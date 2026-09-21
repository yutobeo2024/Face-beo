-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "nationalId" TEXT,
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "address" TEXT,
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
INSERT INTO "new_Employee" ("active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "jobTitleId", "leftAt", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "scheduleType", "sessionVersion", "specialtyId", "workPatternId", "zaloLinkedAt", "zaloUserId") SELECT "active", "avatarUrl", "biometricConsentAt", "code", "createdAt", "defaultShiftId", "departmentId", "failedLogins", "id", "jobTitleId", "leftAt", "lockedUntil", "mustChangePassword", "name", "passwordHash", "phone", "role", "scheduleType", "sessionVersion", "specialtyId", "workPatternId", "zaloLinkedAt", "zaloUserId" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");
CREATE UNIQUE INDEX "Employee_nationalId_key" ON "Employee"("nationalId");
CREATE UNIQUE INDEX "Employee_zaloUserId_key" ON "Employee"("zaloUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

