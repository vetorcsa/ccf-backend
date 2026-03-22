import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { FileFilterCallback } from 'multer';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { UploadExceptionFilter } from './filters/upload-exception.filter';
import { FilesService } from './files.service';

const uploadDir = resolve(process.cwd(), 'uploads', 'xml');
const maxUploadSizeBytes = Number(
  process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 5 * 1024 * 1024,
);
const fileNotFoundInStorageMessage = 'File not found in storage.';
const xmlFileRequiredMessage = 'XML file is required.';

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

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseFilters(new UploadExceptionFilter(maxUploadSizeBytes))
  @UseInterceptors(
    FileInterceptor('file', {
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
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(xmlFileRequiredMessage);
    }

    return this.filesService.create({
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      path: join('uploads', 'xml', file.filename),
      uploadedById: req.user.sub,
    });
  }

  @Get()
  list(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    query: ListFilesQueryDto,
  ) {
    return this.filesService.list(query);
  }

  @Get(':id/analysis')
  analyzeById(@Param('id') id: string) {
    return this.filesService.getFileAnalysisById(id);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.filesService.findPublicById(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response) {
    const file = await this.filesService.findById(id);
    const absolutePath = resolve(process.cwd(), file.path);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException(fileNotFoundInStorageMessage);
    }

    return response.download(absolutePath, file.originalName);
  }
}
