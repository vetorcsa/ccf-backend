import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { BatchProcessingService } from './batch-processing.service';

type BatchProcessingJobData = {
  batchId: string;
};

const defaultQueueName = 'batch-processing';
const defaultWorkerConcurrency = 2;
const defaultJobAttempts = 3;
const defaultBackoffDelay = 2_000;

@Injectable()
export class BatchProcessingQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BatchProcessingQueueService.name);
  private readonly redisUrl = process.env.REDIS_URL?.trim();
  private readonly queueName =
    process.env.BATCH_PROCESSING_QUEUE_NAME?.trim() || defaultQueueName;
  private readonly workerConcurrency = Number(
    process.env.BATCH_PROCESSING_WORKER_CONCURRENCY ??
      defaultWorkerConcurrency,
  );
  private readonly jobAttempts = Number(
    process.env.BATCH_PROCESSING_JOB_ATTEMPTS ?? defaultJobAttempts,
  );

  private queue?: Queue<BatchProcessingJobData>;
  private worker?: Worker<BatchProcessingJobData>;
  private queueConnection?: IORedis;
  private workerConnection?: IORedis;

  private readonly inMemoryQueue = new Set<string>();
  private inMemoryProcessing = false;
  private inMemoryDrainPromise: Promise<void> | null = null;

  constructor(
    private readonly batchProcessingService: BatchProcessingService,
  ) {}

  private getSafePositiveInteger(value: number, fallback: number) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private processWithInMemoryFallback(batchId: string) {
    if (!this.inMemoryQueue.has(batchId)) {
      this.inMemoryQueue.add(batchId);
    }

    if (this.inMemoryProcessing) {
      return;
    }

    this.inMemoryProcessing = true;
    this.inMemoryDrainPromise = (async () => {
      while (this.inMemoryQueue.size > 0) {
        const [nextBatchId] = this.inMemoryQueue;

        if (!nextBatchId) {
          break;
        }

        this.inMemoryQueue.delete(nextBatchId);

        try {
          await this.batchProcessingService.processBatch(nextBatchId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unexpected queue error';

          this.logger.error(
            `Falha ao processar lote ${nextBatchId} no fallback em memória: ${message}`,
          );
        }
      }

      this.inMemoryProcessing = false;
      this.inMemoryDrainPromise = null;
    })();
  }

  async onModuleInit() {
    if (!this.redisUrl) {
      this.logger.warn(
        'REDIS_URL não configurado. Processamento assíncrono rodando em fallback local em memória.',
      );
      return;
    }

    const redisOptions = {
      maxRetriesPerRequest: null,
    };

    this.queueConnection = new IORedis(this.redisUrl, redisOptions);
    this.workerConnection = new IORedis(this.redisUrl, redisOptions);

    try {
      await this.queueConnection.ping();
      await this.workerConnection.ping();

      this.queue = new Queue<BatchProcessingJobData>(this.queueName, {
        connection: this.queueConnection,
      });

      this.worker = new Worker<BatchProcessingJobData>(
        this.queueName,
        async (job: Job<BatchProcessingJobData>) => {
          await this.batchProcessingService.processBatch(job.data.batchId);
        },
        {
          connection: this.workerConnection,
          concurrency: this.getSafePositiveInteger(
            this.workerConcurrency,
            defaultWorkerConcurrency,
          ),
        },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `Falha no job ${job?.id ?? 'unknown'}: ${error.message}`,
        );
      });

      this.logger.log(
        `BullMQ habilitado para processamento de lotes na fila ${this.queueName}.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unexpected Redis error';
      this.logger.error(
        `Não foi possível inicializar BullMQ (${message}). Ativando fallback em memória.`,
      );

      await this.queue?.close();
      await this.worker?.close();

      this.queue = undefined;
      this.worker = undefined;
    }
  }

  async onModuleDestroy() {
    if (this.inMemoryDrainPromise) {
      await this.inMemoryDrainPromise;
    }

    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
  }

  async enqueueBatch(batchId: string) {
    if (this.queue) {
      await this.queue.add(
        'process-batch',
        { batchId },
        {
          jobId: `batch-${batchId}`,
          attempts: this.getSafePositiveInteger(
            this.jobAttempts,
            defaultJobAttempts,
          ),
          backoff: {
            type: 'exponential',
            delay: defaultBackoffDelay,
          },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      );

      return;
    }

    this.processWithInMemoryFallback(batchId);
  }
}
