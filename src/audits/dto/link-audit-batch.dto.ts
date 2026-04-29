import { AuditBatchNature } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class LinkAuditBatchDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsEnum(AuditBatchNature)
  nature!: AuditBatchNature;
}
