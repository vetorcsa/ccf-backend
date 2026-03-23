import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { FileFilterCallback } from 'multer';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UploadExceptionFilter } from '../files/filters/upload-exception.filter';
import { BatchesService } from './batches.service';
import { ListBatchFilesQueryDto } from './dto/list-batch-files-query.dto';
import { ListBatchesQueryDto } from './dto/list-batches-query.dto';

const uploadDir = resolve(process.cwd(), 'uploads', 'xml');
const maxUploadSizeBytes = Number(
  process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 5 * 1024 * 1024,
);
const maxBatchUploadFiles = Number(process.env.BATCH_UPLOAD_MAX_FILES ?? 200);
const batchNameRequiredMessage = 'Batch name is required.';
const xmlFilesRequiredMessage = 'At least one XML file is required.';

type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

const xmlFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) => {
  const hasXmlMimeType =
    file.mimetype === 'application/xml' || file.mimetype === 'text/xml';
  const hasXmlExtension = extname(file.originalname).toLowerCase() === '.xml';

  if (!hasXmlMimeType && !hasXmlExtension) {
    callback(
      new BadRequestException(
        'Only XML files are allowed. Send a .xml file with application/xml or text/xml.',
      ),
    );
    return;
  }

  if (!hasXmlExtension) {
    callback(new BadRequestException('Invalid file extension. Only .xml is allowed.'));
    return;
  }

  if (!hasXmlMimeType) {
    callback(
      new BadRequestException(
        'Invalid MIME type. Use application/xml or text/xml.',
      ),
    );
    return;
  }

  callback(null, true);
};

@Controller('batches')
@UseGuards(JwtAuthGuard)
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  private async cleanupUploadedFiles(files: Express.Multer.File[]) {
    await Promise.allSettled(
      files.map(async (file) => {
        const absolutePath = resolve(process.cwd(), file.path);

        if (existsSync(absolutePath)) {
          await unlink(absolutePath);
        }
      }),
    );
  }

  @Post('upload')
  @UseFilters(new UploadExceptionFilter(maxUploadSizeBytes))
  @UseInterceptors(
    FilesInterceptor('files', maxBatchUploadFiles, {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          mkdirSync(uploadDir, { recursive: true });
          callback(null, uploadDir);
        },
        filename: (_req, file, callback) => {
          const extension = extname(file.originalname).toLowerCase() || '.xml';
          callback(null, `${randomUUID()}${extension}`);
        },
      }),
      fileFilter: xmlFileFilter,
      limits: {
        fileSize: maxUploadSizeBytes,
      },
    }),
  )
  async upload(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name?: string },
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!name) {
      await this.cleanupUploadedFiles(files ?? []);
      throw new BadRequestException(batchNameRequiredMessage);
    }

    if (!files || files.length === 0) {
      throw new BadRequestException(xmlFilesRequiredMessage);
    }

    try {
      return await this.batchesService.createWithFiles({
        name,
        uploadedById: req.user.sub,
        files: files.map((file) => ({
          originalName: file.originalname,
          storedName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          path: join('uploads', 'xml', file.filename),
        })),
      });
    } catch (error) {
      await this.cleanupUploadedFiles(files);
      throw error;
    }
  }

  @Get()
  list(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    query: ListBatchesQueryDto,
  ) {
    return this.batchesService.list(query);
  }

  @Get(':id/files')
  listFiles(
    @Param('id') id: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    query: ListBatchFilesQueryDto,
  ) {
    return this.batchesService.listFiles(id, query);
  }

  @Get(':id/analysis')
  analyze(@Param('id') id: string) {
    return this.batchesService.analyze(id);
  }
}
