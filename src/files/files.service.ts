import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileResponseDto, ListFilesResponseDto } from './dto/file-response.dto';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { filePublicSelect, toFileResponse } from './files.mapper';

type CreateFileInput = {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedById: string;
};

const fileNotFoundMessage = 'File not found.';

@Injectable()
export class FilesService {
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

  async create(input: CreateFileInput): Promise<FileResponseDto> {
    const file = await this.prisma.file.create({
      data: input,
      select: filePublicSelect,
    });

    return toFileResponse(file);
  }

  async list(query: ListFilesQueryDto): Promise<ListFilesResponseDto> {
    const { page, pageSize, search, dateFrom, dateTo } = query;

    const where: Prisma.FileWhereInput = {};

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
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: data.map(toFileResponse),
    };
  }

  async findPublicById(id: string): Promise<FileResponseDto> {
    const file = await this.prisma.file.findUnique({
      where: { id },
      select: filePublicSelect,
    });

    if (!file) {
      throw new NotFoundException(fileNotFoundMessage);
    }

    return toFileResponse(file);
  }

  async findById(id: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException(fileNotFoundMessage);
    }

    return file;
  }
}
