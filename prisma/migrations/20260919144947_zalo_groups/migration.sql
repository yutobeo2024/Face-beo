-- CreateTable
CREATE TABLE "ZaloGroup" (
    "groupId" TEXT NOT NULL PRIMARY KEY,
    "oaId" TEXT,
    "name" TEXT,
    "status" TEXT,
    "totalMember" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'WEBHOOK',
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
