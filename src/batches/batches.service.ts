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
import {
  FileAnalysisDivergenceDto,
  FileAnalysisItemDto,
  FileAnalysisTotalsDto,
} from '../files/dto/file-analysis-response.dto';
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
        totals?: Partial<FileAnalysisTotalsDto>;
        items?: FileAnalysisItemDto[];
      };
    };

    if (!Array.isArray(analysis.divergences) || !Array.isArray(analysis.fiscalNotes)) {
      return null;
    }

    return analysis;
  }

  private getNumberOrZero(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getOwnOperationBase(totals?: Partial<FileAnalysisTotalsDto>) {
    const vBC = this.getNumberOrZero(totals?.vBC);

    if (vBC > 0) {
      return vBC;
    }

    return this.getNumberOrZero(totals?.vProd);
  }

  private isStItem(item: FileAnalysisItemDto) {
    const cfop = item.cfop ?? '';
    const icmsCode = item.taxes.icmsCstOrCsosn ?? '';

    return (
      cfop.startsWith('54') ||
      cfop.startsWith('64') ||
      Boolean(item.cest) ||
      ['10', '30', '60', '70', '90', '201', '202', '203', '500'].includes(
        icmsCode,
      )
    );
  }

  private getItemsTotal(
    items: FileAnalysisItemDto[] | undefined,
    predicate?: (item: FileAnalysisItemDto) => boolean,
  ) {
    return (items ?? []).reduce((total, item) => {
      if (predicate && !predicate(item)) {
        return total;
      }

      return total + this.getNumberOrZero(item.totalValue);
    }, 0);
  }

  private roundCurrency(value: number) {
    return Number(value.toFixed(2));
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
    let totalOwnOperationBase = 0;
    let totalStOperationBase = 0;
    let totalDebitValue = 0;
    let totalDeclaredStValue = 0;
    let totalCalculatedStValue = 0;
    let totalCreditValue = 0;

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

      const totals = cachedAnalysis.document?.totals;
      const items = cachedAnalysis.document?.items;
      const ownOperationBase = this.getOwnOperationBase(totals);
      const declaredStBase = this.getNumberOrZero(totals?.vBCST);
      const stItemsBase = this.getItemsTotal(items, (item) =>
        this.isStItem(item),
      );
      const stOperationBase = declaredStBase > 0 ? declaredStBase : stItemsBase;
      const declaredIcms = this.getNumberOrZero(totals?.vICMS);
      const declaredSt = this.getNumberOrZero(totals?.vST);
      const calculatedSt =
        declaredSt > 0 ? declaredSt : stOperationBase * 0.18;

      totalOwnOperationBase += ownOperationBase;
      totalStOperationBase += stOperationBase;
      totalDebitValue += Math.max(calculatedSt - declaredSt, 0);
      totalDeclaredStValue += declaredSt;
      totalCalculatedStValue += calculatedSt;
      totalCreditValue += Math.max(declaredSt - calculatedSt, 0);

      if (declaredIcms > calculatedSt) {
        totalCreditValue += declaredIcms - calculatedSt;
      }

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

    const roundedTotalOwnOperationBase = this.roundCurrency(
      totalOwnOperationBase,
    );
    const roundedTotalCreditValue = this.roundCurrency(totalCreditValue);
    const roundedTotalStOperationBase = this.roundCurrency(totalStOperationBase);
    const roundedTotalDebitValue = this.roundCurrency(totalDebitValue);
    const roundedTotalDeclaredStValue =
      this.roundCurrency(totalDeclaredStValue);
    const roundedTotalCalculatedStValue = this.roundCurrency(
      totalCalculatedStValue,
    );
    const roundedTotalDifferenceValue = this.roundCurrency(
      totalCalculatedStValue - totalDeclaredStValue,
    );
    const roundedEstimatedFiscalImpact = this.roundCurrency(
      totalDebitValue - totalCreditValue,
    );
    const valueMetrics = [
      {
        key: 'totalOwnOperationBase',
        label: 'Base operação própria',
        value: roundedTotalOwnOperationBase,
      },
      {
        key: 'totalCreditValue',
        label: 'Crédito a restituir',
        value: roundedTotalCreditValue,
      },
      {
        key: 'totalStOperationBase',
        label: 'Base operação ST',
        value: roundedTotalStOperationBase,
      },
      {
        key: 'totalDebitValue',
        label: 'Débito a complementar',
        value: roundedTotalDebitValue,
      },
      {
        key: 'totalDeclaredStValue',
        label: 'ICMS ST declarado',
        value: roundedTotalDeclaredStValue,
      },
      {
        key: 'totalCalculatedStValue',
        label: 'ICMS ST apurado',
        value: roundedTotalCalculatedStValue,
      },
      {
        key: 'totalDifferenceValue',
        label: 'Diferença total apurada',
        value: roundedTotalDifferenceValue,
      },
      {
        key: 'estimatedFiscalImpact',
        label: 'Impacto fiscal estimado',
        value: roundedEstimatedFiscalImpact,
      },
    ];

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
      values: {
        totalOwnOperationBase: roundedTotalOwnOperationBase,
        totalCreditValue: roundedTotalCreditValue,
        totalStOperationBase: roundedTotalStOperationBase,
        totalDebitValue: roundedTotalDebitValue,
        totalDeclaredStValue: roundedTotalDeclaredStValue,
        totalCalculatedStValue: roundedTotalCalculatedStValue,
        totalDifferenceValue: roundedTotalDifferenceValue,
        estimatedFiscalImpact: roundedEstimatedFiscalImpact,
        ownOperationBase: roundedTotalOwnOperationBase,
        totalCredit: roundedTotalCreditValue,
        stOperationBase: roundedTotalStOperationBase,
        totalDebit: roundedTotalDebitValue,
        declaredIcmsSt: roundedTotalDeclaredStValue,
        calculatedIcmsSt: roundedTotalCalculatedStValue,
        totalDifference: roundedTotalDifferenceValue,
        fiscalImpact: roundedEstimatedFiscalImpact,
        metrics: valueMetrics,
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
