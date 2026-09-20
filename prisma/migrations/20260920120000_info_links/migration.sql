-- Thư viện liên kết ("Thông tin" trong trang cá nhân): HR/Quản trị thêm link web app, Google Sheet, Drive…
-- và giới hạn ai được thấy theo vai trò / phòng ban (mảng JSON; rỗng = tất cả).
CREATE TABLE "InfoLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'link',
    "color" TEXT NOT NULL DEFAULT 'brand',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visibleRoles" TEXT NOT NULL DEFAULT '[]',
    "visibleDeptIds" TEXT NOT NULL DEFAULT '[]',
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
