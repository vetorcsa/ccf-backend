-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."FileStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "public"."FileStatus" ADD VALUE 'PROCESSED';
ALTER TYPE "public"."FileStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "public"."Batch" ADD COLUMN     "errorFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "processedFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processingFinishedAt" TIMESTAMP(3),
ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "successFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalFiles" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "analysisData" JSONB,
ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "divergencesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalItems" INTEGER NOT NULL DEFAULT 0;
