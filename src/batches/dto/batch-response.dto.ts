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
