import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Request, Response } from 'express';
import { existsSync, unlinkSync } from 'node:fs';

@Catch(MulterError, PayloadTooLargeException, BadRequestException)
export class UploadExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly maxUploadSizeBytes: number,
    private readonly maxUploadFilesCount?: number,
  ) {}

  catch(
    exception: MulterError | PayloadTooLargeException | BadRequestException,
    host: ArgumentsHost,
  ) {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const requestWithFiles = request as Request & {
      file?: Express.Multer.File;
      files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
    };

    const filesFromRequest: Express.Multer.File[] = [];

    if (requestWithFiles.file) {
      filesFromRequest.push(requestWithFiles.file);
    }

    if (Array.isArray(requestWithFiles.files)) {
      filesFromRequest.push(...requestWithFiles.files);
    } else if (
      requestWithFiles.files &&
      typeof requestWithFiles.files === 'object'
    ) {
      filesFromRequest.push(...Object.values(requestWithFiles.files).flat());
    }

    for (const file of filesFromRequest) {
      if (file.path && existsSync(file.path)) {
        unlinkSync(file.path);
      }
    }

    const isTooLarge =
      exception instanceof PayloadTooLargeException ||
      (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE');
    const isTooManyFiles =
      exception instanceof MulterError &&
      (exception.code === 'LIMIT_FILE_COUNT' ||
        (exception.code === 'LIMIT_UNEXPECTED_FILE' &&
          exception.field === 'files' &&
          Boolean(this.maxUploadFilesCount)));
    const isTooManyFilesBadRequest =
      exception instanceof BadRequestException &&
      exception.message === 'Unexpected field - files' &&
      Boolean(this.maxUploadFilesCount);

    let message = exception.message;

    if (isTooLarge) {
      message = `File is too large. Maximum size is ${this.maxUploadSizeBytes} bytes.`;
    } else if (isTooManyFiles || isTooManyFilesBadRequest) {
      const maxFilesMessage = this.maxUploadFilesCount
        ? ` Limite atual: ${this.maxUploadFilesCount} arquivos.`
        : '';
      message = `Quantidade máxima de arquivos por envio excedida. Envie o lote em partes menores.${maxFilesMessage}`;
    }

    response.status(400).json({
      statusCode: 400,
      message,
      error: 'Bad Request',
    });
  }
}
