-- v1.11.0: tự tra cứu GPHN trên medinet
ALTER TABLE "PracticeLicense" ADD COLUMN "medinetCheckedAt" DATETIME;
ALTER TABLE "PracticeLicense" ADD COLUMN "medinetResult" TEXT;
