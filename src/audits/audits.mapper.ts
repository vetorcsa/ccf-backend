import { Prisma } from '@prisma/client';
import {
  AuditBatchBatchDto,
  AuditBatchResponseDto,
  AuditDetailResponseDto,
  AuditResponseDto,
} from './dto/audit-response.dto';

const auditCreatedBySelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

const auditBatchBatchSelect = {
  id: true,
  name: true,
  status: true,
  totalFiles: true,
  processedFiles: true,
  successFiles: true,
  errorFiles: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      files: true,
    },
  },
} satisfies Prisma.BatchSelect;

export const auditPublicSelect = {
  id: true,
  name: true,
  status: true,
  companyName: true,
  cnpj: true,
  uf: true,
  periodStart: true,
  periodEnd: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: auditCreatedBySelect,
  },
  batches: {
    select: {
      nature: true,
    },
  },
} satisfies Prisma.AuditSelect;

export const auditBatchPublicSelect = {
  id: true,
  nature: true,
  createdAt: true,
  updatedAt: true,
  batch: {
    select: auditBatchBatchSelect,
  },
} satisfies Prisma.AuditBatchSelect;

export const auditDetailSelect = {
  ...auditPublicSelect,
  batches: {
    orderBy: {
      createdAt: 'asc',
    },
    select: auditBatchPublicSelect,
  },
} satisfies Prisma.AuditSelect;

export type AuditPublicRecord = Prisma.AuditGetPayload<{
  select: typeof auditPublicSelect;
}>;

export type AuditDetailRecord = Prisma.AuditGetPayload<{
  select: typeof auditDetailSelect;
}>;

export type AuditBatchPublicRecord = Prisma.AuditBatchGetPayload<{
  select: typeof auditBatchPublicSelect;
}>;

const getSafeTotalFiles = (totalFiles: number, countedFiles: number) =>
  totalFiles > 0 ? totalFiles : countedFiles;

const getProgressPercent = (totalFiles: number, processedFiles: number) => {
  if (totalFiles <= 0) {
    return 0;
  }

  const progress = Math.round((processedFiles / totalFiles) * 100);
  return Math.min(Math.max(progress, 0), 100);
};

const getBatchResponse = (
  batch: AuditBatchPublicRecord['batch'],
): AuditBatchBatchDto => {
  const totalFiles = getSafeTotalFiles(batch.totalFiles, batch._count.files);

  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    totalFiles,
    processedFiles: batch.processedFiles,
    successFiles: batch.successFiles,
    errorFiles: batch.errorFiles,
    pendingFiles: Math.max(totalFiles - batch.processedFiles, 0),
    progressPercent: getProgressPercent(totalFiles, batch.processedFiles),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
};

export const toAuditBatchResponse = (
  auditBatch: AuditBatchPublicRecord,
): AuditBatchResponseDto => ({
  id: auditBatch.id,
  nature: auditBatch.nature,
  createdAt: auditBatch.createdAt,
  updatedAt: auditBatch.updatedAt,
  batch: getBatchResponse(auditBatch.batch),
});

export const toAuditResponse = (
  audit: AuditPublicRecord,
): AuditResponseDto => {
  const inboundBatches = audit.batches.filter(
    (auditBatch) => auditBatch.nature === 'INBOUND',
  ).length;
  const outboundBatches = audit.batches.filter(
    (auditBatch) => auditBatch.nature === 'OUTBOUND',
  ).length;

  return {
    id: audit.id,
    name: audit.name,
    status: audit.status,
    companyName: audit.companyName,
    cnpj: audit.cnpj,
    uf: audit.uf,
    periodStart: audit.periodStart,
    periodEnd: audit.periodEnd,
    totalBatches: audit.batches.length,
    inboundBatches,
    outboundBatches,
    createdBy: {
      id: audit.createdBy.id,
      name: audit.createdBy.name,
      email: audit.createdBy.email,
    },
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  };
};

export const toAuditDetailResponse = (
  audit: AuditDetailRecord,
): AuditDetailResponseDto => ({
  ...toAuditResponse(audit),
  batches: audit.batches.map(toAuditBatchResponse),
});
