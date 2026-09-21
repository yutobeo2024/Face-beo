-- v1.6.0: mỗi nhóm Zalo nhận loại tin riêng.
ALTER TABLE "ZaloGroup" ADD COLUMN "categories" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ZaloGroup" ADD COLUMN "departmentIds" TEXT NOT NULL DEFAULT '[]';

-- Nhóm đang kết nối (AppSetting zaloGroupId) tiếp tục nhận tin minh bạch như trước.
INSERT OR IGNORE INTO "ZaloGroup" ("groupId", "source", "updatedAt")
  SELECT trim("value"), 'MANUAL', CURRENT_TIMESTAMP FROM "AppSetting" WHERE "key" = 'zaloGroupId' AND trim("value") <> '';
UPDATE "ZaloGroup" SET "categories" = '["MINH_BACH"]'
  WHERE "groupId" = (SELECT trim("value") FROM "AppSetting" WHERE "key" = 'zaloGroupId');
