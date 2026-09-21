-- v1.10.0: ảnh khuôn mặt đại diện (tấm nhìn thẳng lúc enroll)
ALTER TABLE "Employee" ADD COLUMN "faceAvatarKey" TEXT;
ALTER TABLE "Employee" ADD COLUMN "faceAvatarAt" DATETIME;
