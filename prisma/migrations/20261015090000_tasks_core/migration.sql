-- v1.23.0: phân hệ Công việc (dự án, thành viên, việc, việc con, phụ thuộc, bình luận, chuông thông báo trong app).
-- CreateTable
CREATE TABLE "Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" INTEGER NOT NULL,
    "zaloGroupId" TEXT,
    "zaloPrefs" TEXT NOT NULL DEFAULT '{"onNewTask":true,"onStatusChange":true,"onTaskNearDueDate":true,"onNewComment":true,"onUserMention":true}',
    "deletedAt" DATETIME,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "addedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "employeeId"),
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startDate" TEXT,
    "dueAt" DATETIME NOT NULL,
    "reminder" TEXT NOT NULL DEFAULT 'NONE',
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "recurrenceTime" TEXT,
    "parentId" INTEGER,
    "occurrenceDate" TEXT,
    "lastOccurrence" TEXT,
    "completedAt" DATETIME,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,

    PRIMARY KEY ("taskId", "employeeId"),
    CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subtask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Subtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" INTEGER NOT NULL,
    "dependsOnId" INTEGER NOT NULL,

    PRIMARY KEY ("taskId", "dependsOnId"),
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "mentions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "projectId" INTEGER,
    "taskId" INTEGER,
    "actorId" INTEGER,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InAppNotification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Project_deletedAt_updatedAt_idx" ON "Project"("deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_zaloGroupId_idx" ON "Project"("zaloGroupId");

-- CreateIndex
CREATE INDEX "ProjectMember_employeeId_idx" ON "ProjectMember"("employeeId");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_dueAt_status_idx" ON "Task"("dueAt", "status");

-- CreateIndex
CREATE INDEX "Task_recurrence_parentId_idx" ON "Task"("recurrence", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_parentId_occurrenceDate_key" ON "Task"("parentId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "TaskAssignee_employeeId_idx" ON "TaskAssignee"("employeeId");

-- CreateIndex
CREATE INDEX "Subtask_taskId_sortOrder_idx" ON "Subtask"("taskId", "sortOrder");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "InAppNotification_dedupeKey_key" ON "InAppNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "InAppNotification_employeeId_readAt_createdAt_idx" ON "InAppNotification"("employeeId", "readAt", "createdAt");


-- Quyền mới: ensureDefaultPermissions có chốt sentinel nên DB đang chạy KHÔNG tự nạp — cấp sẵn tại đây.
-- Quản trị luôn đủ quyền; muốn thu lại thì bỏ tích trong trang Phân quyền.
INSERT OR IGNORE INTO "RolePermission" ("role", "capability") VALUES
  ('HR',       'tasks.use'),
  ('MANAGER',  'tasks.use'),
  ('EMPLOYEE', 'tasks.use'),
  ('HR',       'tasks.createProject'),
  ('MANAGER',  'tasks.createProject'),
  ('HR',       'tasks.manageAll');
