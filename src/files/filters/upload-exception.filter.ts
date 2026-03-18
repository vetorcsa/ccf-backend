import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';

@Catch(MulterError, PayloadTooLargeException)
export class UploadExceptionFilter implements ExceptionFilter {
  constructor(private readonly maxUploadSizeBytes: number) {}

  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

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
