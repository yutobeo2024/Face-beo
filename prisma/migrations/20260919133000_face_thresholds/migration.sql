-- v1.3: nhận diện bằng InsightFace (cosine ArcFace). Ngưỡng mặc định cũ của faceres (0.55 / 0.05) không còn phù hợp:
-- chỉ đổi các dòng vẫn đang mang giá trị mặc định cũ (Quản trị đã tự chỉnh thì giữ nguyên).
UPDATE "AppSetting" SET "value" = '0.45' WHERE "key" = 'matchThreshold' AND "value" IN ('0.55', '0.5', '0.6');
UPDATE "AppSetting" SET "value" = '0.08' WHERE "key" = 'matchMargin' AND "value" IN ('0.05');
