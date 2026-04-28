import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';

const batchProcessingFatalMessage =
  'Unexpected error while processing batch in background.';

@Injectable()
export class BatchProcessingService {
  private readonly logger = new Logger(BatchProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
  ) {}

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

    return batchProcessingFatalMessage;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private isRecordNotFoundError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  async processBatch(batchId: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
      },
    });

    if (!batch) {
      return;
    }

    const files = await this.prisma.file.findMany({
      where: { batchId },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        path: true,
        originalName: true,
        mimeType: true,
        size: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const totalFiles = files.length;
    let processedFiles = 0;
    let successFiles = 0;
    let errorFiles = 0;

    try {
      await this.prisma.batch.update({
        where: { id: batchId },
        data: {
          status: 'PROCESSING',
          totalFiles,
          processedFiles: 0,
          successFiles: 0,
          errorFiles: 0,
          processingStartedAt: new Date(),
          processingFinishedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        return;
      }

      throw error;
    }

    for (const file of files) {
      try {
        try {
          await this.prisma.file.update({
            where: { id: file.id },
            data: {
              status: 'PROCESSING',
              analysisError: null,
            },
          });
        } catch (error) {
          if (this.isRecordNotFoundError(error)) {
            continue;
          }

          throw error;
        }

        const analysis = await this.filesService.getFileAnalysisFromStoredFile({
          id: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          status: 'PROCESSING',
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          path: file.path,
        });

        try {
          await this.prisma.file.update({
            where: { id: file.id },
            data: {
              status: 'PROCESSED',
              totalItems: analysis.analysisSummary.totalItems,
              divergencesCount: analysis.divergences.length,
              analysisData: this.toJsonValue(analysis),
              analysisError: null,
              analyzedAt: new Date(),
            },
          });
        } catch (error) {
          if (this.isRecordNotFoundError(error)) {
            continue;
          }

          throw error;
        }

        processedFiles += 1;
        successFiles += 1;
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);

        try {
          await this.prisma.file.update({
            where: { id: file.id },
            data: {
              status: 'FAILED',
              totalItems: 0,
              divergencesCount: 0,
              analysisData: Prisma.DbNull,
              analysisError: errorMessage,
              analyzedAt: new Date(),
            },
          });
        } catch (innerError) {
          if (this.isRecordNotFoundError(innerError)) {
            continue;
          }

          throw innerError;
        }

        processedFiles += 1;
        errorFiles += 1;
      }

      try {
        await this.prisma.batch.update({
          where: { id: batchId },
          data: {
            processedFiles,
            successFiles,
            errorFiles,
          },
        });
      } catch (error) {
        if (this.isRecordNotFoundError(error)) {
          return;
        }

        throw error;
      }
    }

    const finalStatus =
      errorFiles === 0
        ? 'COMPLETED'
        : successFiles > 0
          ? 'COMPLETED_WITH_ERRORS'
          : 'FAILED';

    try {
      await this.prisma.batch.update({
        where: { id: batchId },
        data: {
          status: finalStatus,
          processingFinishedAt: new Date(),
          lastError:
            finalStatus === 'FAILED'
              ? `Nenhum XML foi processado com sucesso. ${errorFiles} arquivo(s) falharam.`
              : null,
        },
      });
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        return;
      }

      throw error;
    }

    this.logger.log(
      `Batch ${batchId} processado. Total=${totalFiles}, sucesso=${successFiles}, erros=${errorFiles}.`,
    );
  }
}
