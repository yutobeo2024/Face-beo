-- CreateTable
CREATE TABLE "PracticeLicense" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "issuedAt" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TEXT,
    "renewedAt" TEXT,
    "cmeCycleStart" TEXT NOT NULL,
    "workplaceNote" TEXT,
    "verifiedAt" DATETIME,
    "verifiedById" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeLicense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "number" TEXT,
    "issuedAt" TEXT,
    "expiresAt" TEXT,
    "cmeHours" REAL,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Credential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobTitle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiresLicense" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_JobTitle" ("id", "name", "sortOrder") SELECT "id", "name", "sortOrder" FROM "JobTitle";
DROP TABLE "JobTitle";
ALTER TABLE "new_JobTitle" RENAME TO "JobTitle";
CREATE UNIQUE INDEX "JobTitle_name_key" ON "JobTitle"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLicense_employeeId_key" ON "PracticeLicense"("employeeId");

-- CreateIndex
CREATE INDEX "Credential_employeeId_type_idx" ON "Credential"("employeeId", "type");


-- Chức danh lâm sàng / cận lâm sàng mặc định bắt buộc GPHN (Quản trị chỉnh lại trong Cấu hình).
UPDATE "JobTitle" SET "requiresLicense" = true WHERE "name" IN ('Bác sĩ', 'Điều dưỡng', 'Kỹ thuật viên');
