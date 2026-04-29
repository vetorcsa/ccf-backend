import { AuditBatchNature, AuditStatus, BatchStatus } from '@prisma/client';

export type AuditCreatedByDto = {
  id: string;
  name: string;
  email: string;
};

export type AuditResponseDto = {
  id: string;
  name: string;
  status: AuditStatus;
  companyName: string | null;
  cnpj: string | null;
  uf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  totalBatches: number;
  inboundBatches: number;
  outboundBatches: number;
  createdBy: AuditCreatedByDto;
  createdAt: Date;
  updatedAt: Date;
};

export type ListAuditsResponseDto = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: AuditResponseDto[];
};

export type AuditBatchBatchDto = {
  id: string;
  name: string;
  status: BatchStatus;
  totalFiles: number;
  processedFiles: number;
  successFiles: number;
  errorFiles: number;
  pendingFiles: number;
  progressPercent: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AuditBatchResponseDto = {
  id: string;
  nature: AuditBatchNature;
  createdAt: Date;
  updatedAt: Date;
  batch: AuditBatchBatchDto;
};

export type AuditDetailResponseDto = AuditResponseDto & {
  batches: AuditBatchResponseDto[];
};

export type ListAuditBatchesResponseDto = {
  audit: AuditResponseDto;
  data: AuditBatchResponseDto[];
};
