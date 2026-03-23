-- CreateEnum
CREATE TYPE "public"."BatchStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "public"."Batch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."BatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_uploadedById_idx" ON "public"."Batch"("uploadedById");

-- CreateIndex
CREATE INDEX "File_batchId_idx" ON "public"."File"("batchId");

-- AddForeignKey
ALTER TABLE "public"."Batch" ADD CONSTRAINT "Batch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."File" ADD CONSTRAINT "File_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
