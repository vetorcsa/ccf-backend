import { FileStatus } from '@prisma/client';

export type FileUploadedByDto = {
  id: string;
  name: string;
  email: string;
};

export type FileResponseDto = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy: FileUploadedByDto;
};

export type ListFilesResponseDto = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: FileResponseDto[];
};
