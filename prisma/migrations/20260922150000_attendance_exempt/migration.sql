-- v1.12.0: không chấm công (theo phòng + từng người)
ALTER TABLE "Department" ADD COLUMN "attendanceExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "attendanceExempt" BOOLEAN;
