import { Prisma } from '@prisma/client';
import { BatchResponseDto, BatchSummaryDto } from './dto/batch-response.dto';

export const batchPublicSelect = {
  id: true,
  name: true,
  status: true,
  totalFiles: true,
  processedFiles: true,
  successFiles: true,
  errorFiles: true,
  queuedAt: true,
  processingStartedAt: true,
  processingFinishedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      files: true,
    },
  },
  uploadedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.BatchSelect;

export const batchSummarySelect = {
  id: true,
  name: true,
  status: true,
  totalFiles: true,
  processedFiles: true,
  successFiles: true,
  errorFiles: true,
  queuedAt: true,
  processingStartedAt: true,
  processingFinishedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BatchSelect;

export type BatchPublicRecord = Prisma.BatchGetPayload<{
  select: typeof batchPublicSelect;
}>;

export type BatchSummaryRecord = Prisma.BatchGetPayload<{
  select: typeof batchSummarySelect;
}>;

const getSafeTotalFiles = (
  totalFiles: number,
  countedFiles: number,
): number => (totalFiles > 0 ? totalFiles : countedFiles);

const getPendingFiles = (totalFiles: number, processedFiles: number) =>
  Math.max(totalFiles - processedFiles, 0);

const getProgressPercent = (totalFiles: number, processedFiles: number) => {
  if (totalFiles <= 0) {
    return 0;
  }

  const progress = Math.round((processedFiles / totalFiles) * 100);
  return Math.min(Math.max(progress, 0), 100);
};

export const toBatchResponse = (batch: BatchPublicRecord): BatchResponseDto => {
  const totalFiles = getSafeTotalFiles(batch.totalFiles, batch._count.files);

  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    totalFiles,
    processedFiles: batch.processedFiles,
    successFiles: batch.successFiles,
    errorFiles: batch.errorFiles,
    pendingFiles: getPendingFiles(totalFiles, batch.processedFiles),
    progressPercent: getProgressPercent(totalFiles, batch.processedFiles),
    queuedAt: batch.queuedAt,
    processingStartedAt: batch.processingStartedAt,
    processingFinishedAt: batch.processingFinishedAt,
    lastError: batch.lastError,
    uploadedBy: {
      id: batch.uploadedBy.id,
      name: batch.uploadedBy.name,
      email: batch.uploadedBy.email,
    },
  };
};

export const toBatchSummary = (batch: BatchSummaryRecord): BatchSummaryDto => {
  const totalFiles = batch.totalFiles;

  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    totalFiles,
    processedFiles: batch.processedFiles,
    successFiles: batch.successFiles,
    errorFiles: batch.errorFiles,
    pendingFiles: getPendingFiles(totalFiles, batch.processedFiles),
    progressPercent: getProgressPercent(totalFiles, batch.processedFiles),
    queuedAt: batch.queuedAt,
    processingStartedAt: batch.processingStartedAt,
    processingFinishedAt: batch.processingFinishedAt,
    lastError: batch.lastError,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
};
