import { Prisma } from '@prisma/client';
import { BatchResponseDto, BatchSummaryDto } from './dto/batch-response.dto';

export const batchPublicSelect = {
  id: true,
  name: true,
  status: true,
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BatchSelect;

export type BatchPublicRecord = Prisma.BatchGetPayload<{
  select: typeof batchPublicSelect;
}>;

export type BatchSummaryRecord = Prisma.BatchGetPayload<{
  select: typeof batchSummarySelect;
}>;

export const toBatchResponse = (batch: BatchPublicRecord): BatchResponseDto => ({
  id: batch.id,
  name: batch.name,
  status: batch.status,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
  totalFiles: batch._count.files,
  uploadedBy: {
    id: batch.uploadedBy.id,
    name: batch.uploadedBy.name,
    email: batch.uploadedBy.email,
  },
});

export const toBatchSummary = (batch: BatchSummaryRecord): BatchSummaryDto => ({
  id: batch.id,
  name: batch.name,
  status: batch.status,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});
