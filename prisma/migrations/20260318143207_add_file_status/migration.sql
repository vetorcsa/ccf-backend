-- CreateEnum
CREATE TYPE "public"."FileStatus" AS ENUM ('RECEIVED');

-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "status" "public"."FileStatus" NOT NULL DEFAULT 'RECEIVED';
