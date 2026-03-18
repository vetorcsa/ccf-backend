import { Prisma } from '@prisma/client';
import { FileResponseDto } from './dto/file-response.dto';

export const filePublicSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.FileSelect;

export type FilePublicRecord = Prisma.FileGetPayload<{
  select: typeof filePublicSelect;
}>;

export const toFileResponse = (file: FilePublicRecord): FileResponseDto => ({
  id: file.id,
  originalName: file.originalName,
  mimeType: file.mimeType,
  size: file.size,
  status: file.status,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
  uploadedBy: {
    id: file.uploadedBy.id,
    name: file.uploadedBy.name,
    email: file.uploadedBy.email,
  },
});
