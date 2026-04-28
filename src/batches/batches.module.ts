import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { BatchProcessingQueueService } from './batch-processing-queue.service';
import { BatchProcessingService } from './batch-processing.service';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';

@Module({
  imports: [FilesModule],
  controllers: [BatchesController],
  providers: [BatchesService, BatchProcessingService, BatchProcessingQueueService],
  exports: [BatchProcessingQueueService],
})
export class BatchesModule {}
