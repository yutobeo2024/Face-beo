-- v1.20.0 — Kiểm đồng phục (áo) ở lượt chấm VÀO đầu ca.
-- Viết tay bằng ALTER TABLE ADD COLUMN / CREATE TABLE: KHÔNG để Prisma dựng lại bảng, DB thật không phải chép lại
-- AttendanceLog (hàng chục nghìn dòng) và Department. Chỉ THÊM, không sửa/xóa dữ liệu cũ — nên bản v1.19.0 vẫn
-- chạy được trên cơ sở dữ liệu này (quay lui không cần khôi phục dữ liệu).

-- Chế độ kiểm đồng phục của phòng: OFF (mặc định) | SHADOW (chạy thử) | ON
ALTER TABLE "Department" ADD COLUMN "uniformMode" TEXT NOT NULL DEFAULT 'OFF';

-- Khung mặt của lượt quét, JSON "[x,y,w,h]" theo pixel ảnh đã lưu — để cắt vùng áo mà không phải nhận diện lại.
ALTER TABLE "AttendanceLog" ADD COLUMN "faceBox" TEXT;

CREATE TABLE "UniformTemplate" (
    "id"           INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "departmentId" INTEGER  NOT NULL,
    "name"         TEXT     NOT NULL,
    "active"       BOOLEAN  NOT NULL DEFAULT true,
    "embedding"    TEXT,
    "embedVersion" TEXT,
    "colorHist"    TEXT,
    "colorHex"     TEXT,
    "sampleCount"  INTEGER  NOT NULL DEFAULT 0,
    "createdById"  INTEGER,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL
);
CREATE UNIQUE INDEX "UniformTemplate_departmentId_name_key" ON "UniformTemplate"("departmentId", "name");
CREATE INDEX "UniformTemplate_departmentId_active_idx" ON "UniformTemplate"("departmentId", "active");

CREATE TABLE "UniformSample" (
    "id"          INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateId"  INTEGER  NOT NULL,
    "fileKey"     TEXT     NOT NULL,
    "kind"        TEXT     NOT NULL DEFAULT 'SHIRT',
    "embedding"   TEXT,
    "colorHist"   TEXT,
    "createdById" INTEGER,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UniformSample_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "UniformTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UniformSample_templateId_idx" ON "UniformSample"("templateId");

CREATE TABLE "UniformCheck" (
    "id"            INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId"    INTEGER  NOT NULL,
    "workDate"      TEXT     NOT NULL,
    "departmentId"  INTEGER  NOT NULL,
    "shiftId"       INTEGER,
    "logId"         INTEGER,
    "checkTime"     DATETIME NOT NULL,
    "mode"          TEXT     NOT NULL DEFAULT 'ON',
    "machineStatus" TEXT     NOT NULL,
    "status"        TEXT     NOT NULL,
    "reason"        TEXT,
    "templateId"    INTEGER,
    "score"         REAL,
    "embedScore"    REAL,
    "colorScore"    REAL,
    "cropUrl"       TEXT,
    "detail"        TEXT,
    "decidedById"   INTEGER,
    "decidedAt"     DATETIME,
    "note"          TEXT,
    "digestAt"      DATETIME,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "UniformCheck_employeeId_workDate_key" ON "UniformCheck"("employeeId", "workDate");
CREATE INDEX "UniformCheck_workDate_status_idx" ON "UniformCheck"("workDate", "status");
CREATE INDEX "UniformCheck_departmentId_workDate_idx" ON "UniformCheck"("departmentId", "workDate");

-- Quyền mới: ensureDefaultPermissions có chốt sentinel nên DB đang chạy KHÔNG tự nạp — cấp sẵn tại đây.
-- Quản trị luôn đủ quyền; muốn thu lại thì bỏ tích trong trang Phân quyền.
INSERT OR IGNORE INTO "RolePermission" ("role", "capability") VALUES
  ('HR',      'uniform.view'),
  ('HR',      'uniform.decide'),
  ('HR',      'uniform.manage'),
  ('MANAGER', 'uniform.view');
