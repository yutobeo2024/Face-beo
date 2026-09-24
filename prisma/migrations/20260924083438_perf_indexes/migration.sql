-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Employee_active_departmentId_code_idx" ON "Employee"("active", "departmentId", "code");

-- CreateIndex
CREATE INDEX "Employee_role_active_idx" ON "Employee"("role", "active");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_createdAt_idx" ON "LeaveRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_type_status_executedAt_idx" ON "LeaveRequest"("type", "status", "executedAt");
