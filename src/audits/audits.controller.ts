import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { AuditsService } from './audits.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { LinkAuditBatchDto } from './dto/link-audit-batch.dto';
import { ListAuditsQueryDto } from './dto/list-audits-query.dto';

type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

@Controller('audits')
@UseGuards(JwtAuthGuard)
export class AuditsController {
  constructor(private readonly auditsService: AuditsService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    body: CreateAuditDto,
  ) {
    return this.auditsService.create(body, req.user.sub);
  }

  @Get()
  list(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    query: ListAuditsQueryDto,
  ) {
    return this.auditsService.list(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.auditsService.findById(id);
  }

  @Post(':id/batches')
  linkBatch(
    @Param('id') id: string,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    )
    body: LinkAuditBatchDto,
  ) {
    return this.auditsService.linkBatch(id, body);
  }

  @Get(':id/batches')
  listBatches(@Param('id') id: string) {
    return this.auditsService.listBatches(id);
  }
}
