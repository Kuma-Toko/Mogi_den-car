-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Case_createdByUserId_idx" ON "Case"("createdByUserId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "CaseAssignment_studentId_idx" ON "CaseAssignment"("studentId");

-- CreateIndex
CREATE INDEX "EncounterMessage_caseId_idx" ON "EncounterMessage"("caseId");

-- CreateIndex
CREATE INDEX "KarteEntry_caseId_idx" ON "KarteEntry"("caseId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Order_caseId_orderType_idx" ON "Order"("caseId", "orderType");

-- CreateIndex
CREATE INDEX "Order_caseId_status_idx" ON "Order"("caseId", "status");

-- CreateIndex
CREATE INDEX "Order_rpGroupId_idx" ON "Order"("rpGroupId");

-- CreateIndex
CREATE INDEX "Problem_caseId_idx" ON "Problem"("caseId");

-- CreateIndex
CREATE INDEX "Vital_caseId_recordedAt_idx" ON "Vital"("caseId", "recordedAt");
