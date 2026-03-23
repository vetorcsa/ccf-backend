import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Request, Response } from 'express';
import { existsSync, unlinkSync } from 'node:fs';

@Catch(MulterError, PayloadTooLargeException)
export class UploadExceptionFilter implements ExceptionFilter {
  constructor(private readonly maxUploadSizeBytes: number) {}

  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost) {
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

    const message = isTooLarge
      ? `File is too large. Maximum size is ${this.maxUploadSizeBytes} bytes.`
      : exception.message;

    response.status(400).json({
      statusCode: 400,
      message,
      error: 'Bad Request',
    });
  }
}
