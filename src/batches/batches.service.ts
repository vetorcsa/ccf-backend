import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BatchResponseDto,
  BatchAnalysisResponseDto,
  BatchSummaryDto,
  DeleteBatchResponseDto,
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
import { FileAnalysisDivergenceDto } from '../files/dto/file-analysis-response.dto';
import { BatchProcessingQueueService } from './batch-processing-queue.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchProcessingQueueService: BatchProcessingQueueService,
  ) {}

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

  private getErrorMessage(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (response && typeof response === 'object') {
        const responseWithMessage = response as { message?: unknown };

        if (Array.isArray(responseWithMessage.message)) {
          return responseWithMessage.message.join(', ');
        }

        if (typeof responseWithMessage.message === 'string') {
          return responseWithMessage.message;
        }
      }

      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unexpected error while analyzing file.';
  }

  private getCachedFileAnalysis(analysisData: Prisma.JsonValue | null) {
    if (!analysisData || typeof analysisData !== 'object' || Array.isArray(analysisData)) {
      return null;
    }

    const analysis = analysisData as {
      divergences?: FileAnalysisDivergenceDto[];
      fiscalNotes?: string[];
      analysisSummary?: {
        totalItems?: number;
      };
      document?: {
        issuedAt?: string | null;
      };
    };

    if (!Array.isArray(analysis.divergences) || !Array.isArray(analysis.fiscalNotes)) {
      return null;
    }

    return analysis;
  }

  private getSafeTotalFiles(totalFiles: number, fallbackCount: number) {
    return totalFiles > 0 ? totalFiles : fallbackCount;
  }

  async findById(id: string): Promise<BatchResponseDto> {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      select: batchPublicSelect,
    });

    if (!batch) {
      throw new NotFoundException(batchNotFoundMessage);
    }

    return toBatchResponse(batch);
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
    const created = await this.prisma.$transaction(async (transaction) => {
      const queuedAt = new Date();

      const batch = await transaction.batch.create({
        data: {
          name: input.name,
          uploadedById: input.uploadedById,
          totalFiles: input.files.length,
          queuedAt,
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
        batchId: batch.id,
        batch: {
          id: batch.id,
          name: batch.name,
          status: batch.status,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          totalFiles: createdFiles.count,
          processedFiles: 0,
          successFiles: 0,
          errorFiles: 0,
          pendingFiles: createdFiles.count,
          progressPercent: 0,
          queuedAt,
          processingStartedAt: null,
          processingFinishedAt: null,
          lastError: null,
        },
        files: {
          accepted: createdFiles.count,
          rejected: 0,
        },
      };
    });

    try {
      await this.batchProcessingQueueService.enqueueBatch(created.batchId);
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);

      await this.prisma.batch.update({
        where: { id: created.batchId },
        data: {
          status: 'FAILED',
          lastError: `Falha ao enfileirar processamento: ${errorMessage}`,
          processingFinishedAt: new Date(),
        },
      });

      throw new InternalServerErrorException(
        'Failed to enqueue batch processing job.',
      );
    }

    return {
      batch: created.batch,
      files: created.files,
    };
  }

  async analyze(batchId: string): Promise<BatchAnalysisResponseDto> {
    const batch = await this.findBatchSummaryById(batchId);
    const files = await this.prisma.file.findMany({
      where: { batchId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        status: true,
        analysisData: true,
        analysisError: true,
        totalItems: true,
        divergencesCount: true,
      },
    });

    const divergenceAggregator = new Map<
      string,
      {
        divergence: FileAnalysisDivergenceDto;
        documentIds: Set<string>;
        occurrences: number;
      }
    >();
    const fiscalNoteAggregator = new Map<
      string,
      {
        documentIds: Set<string>;
        occurrences: number;
      }
    >();

    const documentsWithDivergences: BatchAnalysisResponseDto['documents']['withDivergences'] =
      [];
    const documentsWithErrors: BatchAnalysisResponseDto['documents']['withErrors'] = [];

    let totalProcessed = 0;
    let totalWithDivergences = 0;
    let totalItems = 0;
    let startIssuedAt: Date | null = null;
    let endIssuedAt: Date | null = null;

    for (const file of files) {
      const cachedAnalysis = this.getCachedFileAnalysis(file.analysisData);

      if (file.status === 'FAILED') {
        documentsWithErrors.push({
          fileId: file.id,
          originalName: file.originalName,
          error:
            file.analysisError ??
            'File processing failed in background pipeline.',
        });
        continue;
      }

      if (file.status !== 'PROCESSED' || !cachedAnalysis) {
        continue;
      }

      totalProcessed += 1;
      totalItems += file.totalItems;

      if (cachedAnalysis.document?.issuedAt) {
        const issuedAt = new Date(cachedAnalysis.document.issuedAt);

        if (!Number.isNaN(issuedAt.getTime())) {
          if (!startIssuedAt || issuedAt < startIssuedAt) {
            startIssuedAt = issuedAt;
          }

          if (!endIssuedAt || issuedAt > endIssuedAt) {
            endIssuedAt = issuedAt;
          }
        }
      }

      if (file.divergencesCount > 0) {
        totalWithDivergences += 1;
        documentsWithDivergences.push({
          fileId: file.id,
          originalName: file.originalName,
          divergencesCount: file.divergencesCount,
          items: file.totalItems,
        });
      }

      for (const divergence of cachedAnalysis.divergences ?? []) {
        const existing = divergenceAggregator.get(divergence.code);

        if (!existing) {
          divergenceAggregator.set(divergence.code, {
            divergence,
            documentIds: new Set([file.id]),
            occurrences: 1,
          });
          continue;
        }

        existing.documentIds.add(file.id);
        existing.occurrences += 1;
      }

      for (const note of cachedAnalysis.fiscalNotes ?? []) {
        const existing = fiscalNoteAggregator.get(note);

        if (!existing) {
          fiscalNoteAggregator.set(note, {
            documentIds: new Set([file.id]),
            occurrences: 1,
          });
          continue;
        }

        existing.documentIds.add(file.id);
        existing.occurrences += 1;
      }
    }

    const divergences = [...divergenceAggregator.values()]
      .map(({ divergence, documentIds, occurrences }) => ({
        code: divergence.code,
        title: divergence.title,
        description: divergence.description,
        severity: divergence.severity,
        documentsCount: documentIds.size,
        occurrences,
        sampleDocumentIds: [...documentIds].slice(0, 5),
      }))
      .sort((left, right) => {
        if (right.documentsCount !== left.documentsCount) {
          return right.documentsCount - left.documentsCount;
        }

        return right.occurrences - left.occurrences;
      });

    const fiscalNotes = [...fiscalNoteAggregator.entries()]
      .map(([note, { documentIds, occurrences }]) => ({
        note,
        documentsCount: documentIds.size,
        occurrences,
        sampleDocumentIds: [...documentIds].slice(0, 5),
      }))
      .sort((left, right) => {
        if (right.documentsCount !== left.documentsCount) {
          return right.documentsCount - left.documentsCount;
        }

        return right.occurrences - left.occurrences;
      });

    documentsWithDivergences.sort(
      (left, right) => right.divergencesCount - left.divergencesCount,
    );

    return {
      batch,
      period: {
        startIssuedAt: startIssuedAt ? startIssuedAt.toISOString() : null,
        endIssuedAt: endIssuedAt ? endIssuedAt.toISOString() : null,
      },
      summary: {
        totalDocuments: this.getSafeTotalFiles(batch.totalFiles, files.length),
        totalFiles: this.getSafeTotalFiles(batch.totalFiles, files.length),
        totalProcessed,
        totalWithDivergences,
        totalWithErrors: documentsWithErrors.length,
        totalItems,
        conformingDocuments: totalProcessed - totalWithDivergences,
      },
      divergences,
      fiscalNotes,
      documents: {
        withDivergences: documentsWithDivergences,
        withErrors: documentsWithErrors,
      },
    };
  }

  async remove(batchId: string): Promise<DeleteBatchResponseDto> {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!batch) {
      throw new NotFoundException(batchNotFoundMessage);
    }

    const files = await this.prisma.file.findMany({
      where: { batchId },
      select: {
        path: true,
      },
    });

    let deletedPhysicalFiles = 0;
    let missingPhysicalFiles = 0;

    for (const file of files) {
      const absolutePath = resolve(process.cwd(), file.path);

      if (!existsSync(absolutePath)) {
        missingPhysicalFiles += 1;
        continue;
      }

      try {
        await unlink(absolutePath);
        deletedPhysicalFiles += 1;
      } catch {
        throw new InternalServerErrorException(
          `Failed to remove file from storage: ${file.path}`,
        );
      }
    }

    const deletedFiles = await this.prisma.$transaction(async (transaction) => {
      const deleted = await transaction.file.deleteMany({
        where: { batchId },
      });

      await transaction.batch.delete({
        where: { id: batchId },
      });

      return deleted;
    });

    return {
      batch: {
        id: batch.id,
        name: batch.name,
      },
      files: {
        deletedRecords: deletedFiles.count,
        deletedPhysicalFiles,
        missingPhysicalFiles,
      },
    };
  }
}
