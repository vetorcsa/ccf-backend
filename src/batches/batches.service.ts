import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BatchSummaryDto,
  ListBatchFilesResponseDto,
  ListBatchesResponseDto,
  UploadBatchResponseDto,
} from './dto/batch-response.dto';
import { ListBatchFilesQueryDto } from './dto/list-batch-files-query.dto';
import { ListBatchesQueryDto } from './dto/list-batches-query.dto';
import {
  batchPublicSelect,
  batchSummarySelect,
  toBatchResponse,
  toBatchSummary,
} from './batches.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { filePublicSelect, toFileResponse } from '../files/files.mapper';

const batchNotFoundMessage = 'Batch not found.';

type CreateBatchWithFilesInput = {
  name: string;
  uploadedById: string;
  files: Array<{
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    path: string;
  }>;
};

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  private getDateFrom(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00.000Z`);
    }

    return new Date(value);
  }

  private getDateTo(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }

    return new Date(value);
  }

  private async findBatchSummaryById(id: string): Promise<BatchSummaryDto> {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      select: batchSummarySelect,
    });

    if (!batch) {
      throw new NotFoundException(batchNotFoundMessage);
    }

    return toBatchSummary(batch);
  }

  async list(query: ListBatchesQueryDto): Promise<ListBatchesResponseDto> {
    const { page, pageSize, search, dateFrom, dateTo } = query;
    const where: Prisma.BatchWhereInput = {};

    if (search) {
      where.name = {
        contains: search,
        mode: 'insensitive',
      };
    }

    const createdAt: Prisma.DateTimeFilter = {};

    if (dateFrom) {
      createdAt.gte = this.getDateFrom(dateFrom);
    }

    if (dateTo) {
      createdAt.lte = this.getDateTo(dateTo);
    }

    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: batchPublicSelect,
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: data.map(toBatchResponse),
    };
  }

  async listFiles(
    batchId: string,
    query: ListBatchFilesQueryDto,
  ): Promise<ListBatchFilesResponseDto> {
    const batch = await this.findBatchSummaryById(batchId);
    const { page, pageSize, search, dateFrom, dateTo } = query;
    const where: Prisma.FileWhereInput = {
      batchId,
    };

    if (search) {
      where.originalName = {
        contains: search,
        mode: 'insensitive',
      };
    }

    const createdAt: Prisma.DateTimeFilter = {};

    if (dateFrom) {
      createdAt.gte = this.getDateFrom(dateFrom);
    }

    if (dateTo) {
      createdAt.lte = this.getDateTo(dateTo);
    }

    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.file.count({ where }),
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: filePublicSelect,
      }),
    ]);

    return {
      batch,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: data.map(toFileResponse),
    };
  }

  async createWithFiles(
    input: CreateBatchWithFilesInput,
  ): Promise<UploadBatchResponseDto> {
    return this.prisma.$transaction(async (transaction) => {
      const batch = await transaction.batch.create({
        data: {
          name: input.name,
          uploadedById: input.uploadedById,
        },
      });

      const createdFiles = await transaction.file.createMany({
        data: input.files.map((file) => ({
          originalName: file.originalName,
          storedName: file.storedName,
          mimeType: file.mimeType,
          size: file.size,
          path: file.path,
          uploadedById: input.uploadedById,
          batchId: batch.id,
        })),
      });

      return {
        batch: {
          id: batch.id,
          name: batch.name,
          status: batch.status,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          totalFiles: createdFiles.count,
        },
        files: {
          accepted: createdFiles.count,
          rejected: 0,
        },
      };
    });
  }
}
