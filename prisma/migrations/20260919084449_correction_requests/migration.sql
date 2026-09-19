-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN "sourceRequestId" INTEGER;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "correctionAt" DATETIME;
ALTER TABLE "LeaveRequest" ADD COLUMN "correctionKind" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "executedAt" DATETIME;
ALTER TABLE "LeaveRequest" ADD COLUMN "executedById" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN "executedLogId" INTEGER;
