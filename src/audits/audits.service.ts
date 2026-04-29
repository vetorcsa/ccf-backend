import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  auditBatchPublicSelect,
  auditDetailSelect,
  auditPublicSelect,
  toAuditBatchResponse,
  toAuditDetailResponse,
  toAuditResponse,
} from './audits.mapper';
import {
  AuditBatchResponseDto,
  AuditDetailResponseDto,
  AuditResponseDto,
  ListAuditBatchesResponseDto,
  ListAuditsResponseDto,
} from './dto/audit-response.dto';
import { CreateAuditDto } from './dto/create-audit.dto';
import { LinkAuditBatchDto } from './dto/link-audit-batch.dto';
import { ListAuditsQueryDto } from './dto/list-audits-query.dto';

const auditNotFoundMessage = 'Audit not found.';
const batchNotFoundMessage = 'Batch not found.';
const auditBatchAlreadyLinkedMessage = 'Batch is already linked to this audit.';

@Injectable()
export class AuditsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeOptionalString(value?: string) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
  }

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

  private async findAuditOrThrow(id: string): Promise<AuditResponseDto> {
    const audit = await this.prisma.audit.findUnique({
      where: { id },
      select: auditPublicSelect,
    });

    if (!audit) {
      throw new NotFoundException(auditNotFoundMessage);
    }

    return toAuditResponse(audit);
  }

  async create(
    input: CreateAuditDto,
    createdById: string,
  ): Promise<AuditResponseDto> {
    const audit = await this.prisma.audit.create({
      data: {
        name: input.name.trim(),
        companyName: this.normalizeOptionalString(input.companyName),
        cnpj: this.normalizeOptionalString(input.cnpj),
        uf: this.normalizeOptionalString(input.uf)?.toUpperCase() ?? null,
        periodStart: input.periodStart ? new Date(input.periodStart) : null,
        periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
        createdById,
      },
      select: auditPublicSelect,
    });

    return toAuditResponse(audit);
  }

  async list(query: ListAuditsQueryDto): Promise<ListAuditsResponseDto> {
    const { page, pageSize, search, status, dateFrom, dateTo } = query;
    const where: Prisma.AuditWhereInput = {};

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          companyName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          cnpj: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (status) {
      where.status = status;
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
      this.prisma.audit.count({ where }),
      this.prisma.audit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: auditPublicSelect,
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: data.map(toAuditResponse),
    };
  }

  async findById(id: string): Promise<AuditDetailResponseDto> {
    const audit = await this.prisma.audit.findUnique({
      where: { id },
      select: auditDetailSelect,
    });

    if (!audit) {
      throw new NotFoundException(auditNotFoundMessage);
    }

    return toAuditDetailResponse(audit);
  }

  async linkBatch(
    auditId: string,
    input: LinkAuditBatchDto,
  ): Promise<AuditBatchResponseDto> {
    await this.findAuditOrThrow(auditId);

    const batch = await this.prisma.batch.findUnique({
      where: { id: input.batchId },
      select: { id: true },
    });

    if (!batch) {
      throw new NotFoundException(batchNotFoundMessage);
    }

    try {
      const auditBatch = await this.prisma.auditBatch.create({
        data: {
          auditId,
          batchId: input.batchId,
          nature: input.nature,
        },
        select: auditBatchPublicSelect,
      });

      return toAuditBatchResponse(auditBatch);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(auditBatchAlreadyLinkedMessage);
      }

      throw error;
    }
  }

  async listBatches(auditId: string): Promise<ListAuditBatchesResponseDto> {
    const audit = await this.findAuditOrThrow(auditId);
    const auditBatches = await this.prisma.auditBatch.findMany({
      where: { auditId },
      orderBy: { createdAt: 'asc' },
      select: auditBatchPublicSelect,
    });

    return {
      audit,
      data: auditBatches.map(toAuditBatchResponse),
    };
  }
}
