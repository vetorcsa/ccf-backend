-- CreateEnum
CREATE TYPE "public"."AuditStatus" AS ENUM ('DRAFT', 'RECEIVED', 'NORMALIZING', 'ENRICHING', 'CROSSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."AuditBatchNature" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "public"."Audit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."AuditStatus" NOT NULL DEFAULT 'DRAFT',
    "companyName" TEXT,
    "cnpj" TEXT,
    "uf" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditBatch" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "nature" "public"."AuditBatchNature" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Audit_createdById_idx" ON "public"."Audit"("createdById");

-- CreateIndex
CREATE INDEX "Audit_status_idx" ON "public"."Audit"("status");

-- CreateIndex
CREATE INDEX "AuditBatch_auditId_idx" ON "public"."AuditBatch"("auditId");

-- CreateIndex
CREATE INDEX "AuditBatch_batchId_idx" ON "public"."AuditBatch"("batchId");

-- CreateIndex
CREATE INDEX "AuditBatch_nature_idx" ON "public"."AuditBatch"("nature");

-- CreateIndex
CREATE UNIQUE INDEX "AuditBatch_auditId_batchId_key" ON "public"."AuditBatch"("auditId", "batchId");

-- AddForeignKey
ALTER TABLE "public"."Audit" ADD CONSTRAINT "Audit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditBatch" ADD CONSTRAINT "AuditBatch_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditBatch" ADD CONSTRAINT "AuditBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
