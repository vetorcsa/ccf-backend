import { BatchStatus } from '@prisma/client';
import { FileResponseDto } from '../../files/dto/file-response.dto';

export type BatchUploadedByDto = {
  id: string;
  name: string;
  email: string;
};

export type BatchResponseDto = {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: Date;
  updatedAt: Date;
  totalFiles: number;
  uploadedBy: BatchUploadedByDto;
};

export type ListBatchesResponseDto = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: BatchResponseDto[];
};

export type BatchSummaryDto = {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ListBatchFilesResponseDto = {
  batch: BatchSummaryDto;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: FileResponseDto[];
};

export type UploadBatchResponseDto = {
  batch: {
    id: string;
    name: string;
    status: BatchStatus;
    createdAt: Date;
    updatedAt: Date;
    totalFiles: number;
  };
  files: {
    accepted: number;
    rejected: number;
  };
};

export type BatchAnalysisSummaryDto = {
  totalDocuments: number;
  totalFiles: number;
  totalProcessed: number;
  totalWithDivergences: number;
  totalWithErrors: number;
  totalItems: number;
  conformingDocuments: number;
};

export type BatchAnalysisPeriodDto = {
  startIssuedAt: string | null;
  endIssuedAt: string | null;
};

export type BatchAnalysisDivergenceDto = {
  code: string;
  title: string;
  description: string;
  severity: 'INFO' | 'WARNING';
  documentsCount: number;
  occurrences: number;
  sampleDocumentIds: string[];
};

export type BatchAnalysisFiscalNoteDto = {
  note: string;
  documentsCount: number;
  occurrences: number;
  sampleDocumentIds: string[];
};

export type BatchAnalysisDocumentWithDivergencesDto = {
  fileId: string;
  originalName: string;
  divergencesCount: number;
  items: number;
};

export type BatchAnalysisDocumentWithErrorDto = {
  fileId: string;
  originalName: string;
  error: string;
};

export type BatchAnalysisResponseDto = {
  batch: BatchSummaryDto;
  period: BatchAnalysisPeriodDto;
  summary: BatchAnalysisSummaryDto;
  divergences: BatchAnalysisDivergenceDto[];
  fiscalNotes: BatchAnalysisFiscalNoteDto[];
  documents: {
    withDivergences: BatchAnalysisDocumentWithDivergencesDto[];
    withErrors: BatchAnalysisDocumentWithErrorDto[];
  };
};

export type DeleteBatchResponseDto = {
  batch: {
    id: string;
    name: string;
  };
  files: {
    deletedRecords: number;
    deletedPhysicalFiles: number;
    missingPhysicalFiles: number;
  };
};
