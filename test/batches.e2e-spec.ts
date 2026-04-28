import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Batches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminUserId: string;

  const adminEmail = 'admin@example.com';
  const adminPassword = '123456';
  const uploadDir = resolve(process.cwd(), 'uploads', 'xml');
  const maxBatchUploadFiles = Number(process.env.BATCH_UPLOAD_MAX_FILES ?? 1200);
  const waitForBatchTimeoutMs = 15_000;
  const waitForBatchIntervalMs = 150;

  const sleep = (ms: number) =>
    new Promise((resolvePromise) => {
      setTimeout(resolvePromise, ms);
    });

  const cleanUploads = () => {
    rmSync(uploadDir, { recursive: true, force: true });
  };

  const seedAdminUser = async () => {
    const passwordHash = await hash(adminPassword, 10);

    const adminUser = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        name: 'Admin',
        passwordHash,
        role: UserRole.ADMIN,
      },
      create: {
        name: 'Admin',
        email: adminEmail,
        passwordHash,
        role: UserRole.ADMIN,
      },
    });

    adminUserId = adminUser.id;
  };

  const loginAndGetToken = async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);

    return response.body.accessToken as string;
  };

  const waitForBatchToFinish = async (token: string, batchId: string) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < waitForBatchTimeoutMs) {
      const response = await request(app.getHttpServer())
        .get(`/batches/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      if (
        ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(
          response.body.status,
        )
      ) {
        return response.body;
      }

      await sleep(waitForBatchIntervalMs);
    }

    throw new Error(`Timed out waiting batch ${batchId} to finish processing.`);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();
  });

  beforeEach(async () => {
    cleanUploads();
    await prisma.file.deleteMany();
    await prisma.batch.deleteMany();
    await seedAdminUser();
  });

  afterAll(async () => {
    cleanUploads();
    await prisma.file.deleteMany();
    await prisma.batch.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /batches/upload cria lote e vincula múltiplos XMLs', async () => {
    const token = await loginAndGetToken();

    const response = await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Supermercado A')
      .attach('files', Buffer.from('<root><n>1</n></root>'), {
        filename: 'file-1.xml',
        contentType: 'application/xml',
      })
      .attach('files', Buffer.from('<root><n>2</n></root>'), {
        filename: 'file-2.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    expect(response.body.batch).toMatchObject({
      id: expect.any(String),
      name: 'Supermercado A',
      status: 'RECEIVED',
      totalFiles: 2,
    });
    expect(response.body.files).toEqual({
      accepted: 2,
      rejected: 0,
    });

    expect(response.body.batch.createdAt).toEqual(expect.any(String));
    expect(response.body.batch.updatedAt).toEqual(expect.any(String));
  });

  it('POST /batches/upload valida nome obrigatório', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('<root/>'), {
        filename: 'file-1.xml',
        contentType: 'application/xml',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('Batch name is required.');
      });
  });

  it('POST /batches/upload valida envio de pelo menos um arquivo', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Sem arquivos')
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('At least one XML file is required.');
      });
  });

  it('POST /batches/upload rejeita arquivo não XML', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Lote inválido')
      .attach('files', Buffer.from('plain text'), {
        filename: 'file.txt',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain('Only XML files are allowed');
      });
  });

  it('POST /batches/upload rejeita quando excede o limite máximo de arquivos', async () => {
    const token = await loginAndGetToken();
    let requestBuilder = request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Lote muito grande');

    for (let index = 0; index < maxBatchUploadFiles + 1; index += 1) {
      requestBuilder = requestBuilder.attach(
        'files',
        Buffer.from('<root/>'),
        {
          filename: `max-limit-${index}.xml`,
          contentType: 'application/xml',
        },
      );
    }

    await requestBuilder.expect(400).expect(({ body }) => {
      expect(body.message).toBe(
        `Quantidade máxima de arquivos por envio excedida. Envie o lote em partes menores. Limite atual: ${maxBatchUploadFiles} arquivos.`,
      );
    });
  });

  it('GET /batches exige autenticação', async () => {
    await request(app.getHttpServer()).get('/batches').expect(401);
  });

  it('GET /batches/:id retorna status e progresso do lote', async () => {
    const token = await loginAndGetToken();

    const batch = await prisma.batch.create({
      data: {
        name: 'Lote com progresso',
        uploadedById: adminUserId,
        totalFiles: 10,
        processedFiles: 4,
        successFiles: 3,
        errorFiles: 1,
        status: 'PROCESSING',
      },
    });

    await request(app.getHttpServer())
      .get(`/batches/${batch.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: batch.id,
          name: 'Lote com progresso',
          status: 'PROCESSING',
          totalFiles: 10,
          processedFiles: 4,
          successFiles: 3,
          errorFiles: 1,
          pendingFiles: 6,
          progressPercent: 40,
        });
      });
  });

  it('GET /batches lista lotes com paginação e filtros', async () => {
    const token = await loginAndGetToken();

    const firstBatch = await prisma.batch.create({
      data: {
        name: 'Supermercado A',
        uploadedById: adminUserId,
      },
    });

    const secondBatch = await prisma.batch.create({
      data: {
        name: 'Supermercado B',
        uploadedById: adminUserId,
      },
    });

    await prisma.file.createMany({
      data: [
        {
          originalName: 'a1.xml',
          storedName: 'stored-a1.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-a1.xml',
          uploadedById: adminUserId,
          batchId: firstBatch.id,
        },
        {
          originalName: 'b1.xml',
          storedName: 'stored-b1.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-b1.xml',
          uploadedById: adminUserId,
          batchId: secondBatch.id,
        },
        {
          originalName: 'b2.xml',
          storedName: 'stored-b2.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-b2.xml',
          uploadedById: adminUserId,
          batchId: secondBatch.id,
        },
      ],
    });

    await request(app.getHttpServer())
      .get('/batches')
      .query({
        page: 1,
        pageSize: 10,
        search: 'mercado b',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(10);
        expect(body.total).toBe(1);
        expect(body.totalPages).toBe(1);
        expect(body.data.length).toBe(1);
        expect(body.data[0]).toMatchObject({
          id: secondBatch.id,
          name: 'Supermercado B',
          status: 'RECEIVED',
          totalFiles: 2,
        });
        expect(body.data[0].uploadedBy).toEqual({
          id: adminUserId,
          name: 'Admin',
          email: adminEmail,
        });
      });
  });

  it('GET /batches/:id/files lista arquivos do lote com paginação e filtros', async () => {
    const token = await loginAndGetToken();

    const targetBatch = await prisma.batch.create({
      data: {
        name: 'Lote Target',
        uploadedById: adminUserId,
      },
    });

    const otherBatch = await prisma.batch.create({
      data: {
        name: 'Outro Lote',
        uploadedById: adminUserId,
      },
    });

    await prisma.file.createMany({
      data: [
        {
          originalName: 'target-1.xml',
          storedName: 'stored-target-1.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-target-1.xml',
          uploadedById: adminUserId,
          batchId: targetBatch.id,
        },
        {
          originalName: 'target-2.xml',
          storedName: 'stored-target-2.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-target-2.xml',
          uploadedById: adminUserId,
          batchId: targetBatch.id,
        },
        {
          originalName: 'other-1.xml',
          storedName: 'stored-other-1.xml',
          mimeType: 'application/xml',
          size: 10,
          path: 'uploads/xml/stored-other-1.xml',
          uploadedById: adminUserId,
          batchId: otherBatch.id,
        },
      ],
    });

    await request(app.getHttpServer())
      .get(`/batches/${targetBatch.id}/files`)
      .query({
        page: 1,
        pageSize: 1,
        search: 'target-1',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.batch).toMatchObject({
          id: targetBatch.id,
          name: 'Lote Target',
          status: 'RECEIVED',
        });
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(1);
        expect(body.total).toBe(1);
        expect(body.totalPages).toBe(1);
        expect(body.data.length).toBe(1);
        expect(body.data[0]).toMatchObject({
          originalName: 'target-1.xml',
          mimeType: 'application/xml',
          status: 'RECEIVED',
        });
      });
  });

  it('GET /batches/:id/files retorna 404 para lote inexistente', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .get('/batches/lote-inexistente/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Batch not found.');
      });
  });

  it('GET /batches/:id/analysis agrega analise do lote sem quebrar em erro parcial', async () => {
    const token = await loginAndGetToken();
    const validXmlBuffer = readFileSync(
      resolve(process.cwd(), 'http', 'XML', 'file1.xml'),
    );

    const uploadResponse = await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Lote Analise')
      .attach('files', validXmlBuffer, {
        filename: 'valido.xml',
        contentType: 'application/xml',
      })
      .attach('files', Buffer.from('<nfeProc><NFe></nfeProc>'), {
        filename: 'invalido.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    const batchId = uploadResponse.body.batch.id as string;
    const finalBatch = await waitForBatchToFinish(token, batchId);

    expect(finalBatch.status).toBe('COMPLETED_WITH_ERRORS');
    expect(finalBatch.totalFiles).toBe(2);
    expect(finalBatch.processedFiles).toBe(2);
    expect(finalBatch.errorFiles).toBe(1);
    expect(finalBatch.successFiles).toBe(1);

    await request(app.getHttpServer())
      .get(`/batches/${batchId}/analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.batch).toMatchObject({
          id: batchId,
          name: 'Lote Analise',
        });

        expect(body.period).toMatchObject({
          startIssuedAt: '2022-01-02T11:17:08.000Z',
          endIssuedAt: '2022-01-02T11:17:08.000Z',
        });

        expect(body.summary).toMatchObject({
          totalDocuments: 2,
          totalFiles: 2,
          totalProcessed: 1,
          totalWithErrors: 1,
        });
        expect(body.summary.totalWithDivergences).toBeGreaterThanOrEqual(0);
        expect(body.summary.totalItems).toBeGreaterThan(0);

        const divergenceCodes = body.divergences.map(
          (divergence: { code: string }) => divergence.code,
        );
        expect(divergenceCodes).toEqual(
          expect.arrayContaining([
            'CFOP_MIX',
            'MISSING_CEST',
            'ICMS_CST_CSOSN_MIX',
            'PIS_COFINS_ZERO',
          ]),
        );

        expect(body.fiscalNotes.length).toBeGreaterThan(0);
        expect(body.documents.withErrors.length).toBe(1);
        expect(body.documents.withErrors[0]).toMatchObject({
          originalName: 'invalido.xml',
        });
        expect(body.documents.withErrors[0].error).toEqual(expect.any(String));
      });
  });

  it('GET /batches/:id/analysis retorna 404 para lote inexistente', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .get('/batches/lote-inexistente/analysis')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Batch not found.');
      });
  });

  it('DELETE /batches/:id remove lote, registros vinculados e arquivos físicos', async () => {
    const token = await loginAndGetToken();

    const uploadResponse = await request(app.getHttpServer())
      .post('/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Lote para excluir')
      .attach('files', Buffer.from('<root><n>1</n></root>'), {
        filename: 'delete-1.xml',
        contentType: 'application/xml',
      })
      .attach('files', Buffer.from('<root><n>2</n></root>'), {
        filename: 'delete-2.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    const batchId = uploadResponse.body.batch.id as string;
    const filesBeforeDelete = await prisma.file.findMany({
      where: { batchId },
      select: {
        path: true,
      },
    });

    expect(filesBeforeDelete.length).toBe(2);
    for (const file of filesBeforeDelete) {
      expect(existsSync(resolve(process.cwd(), file.path))).toBe(true);
    }

    await request(app.getHttpServer())
      .delete(`/batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.batch).toMatchObject({
          id: batchId,
          name: 'Lote para excluir',
        });
        expect(body.files).toMatchObject({
          deletedRecords: 2,
          deletedPhysicalFiles: 2,
          missingPhysicalFiles: 0,
        });
      });

    const batchAfterDelete = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    const filesAfterDeleteCount = await prisma.file.count({
      where: { batchId },
    });

    expect(batchAfterDelete).toBeNull();
    expect(filesAfterDeleteCount).toBe(0);

    for (const file of filesBeforeDelete) {
      expect(existsSync(resolve(process.cwd(), file.path))).toBe(false);
    }
  });

  it('DELETE /batches/:id retorna 404 para lote inexistente', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .delete('/batches/lote-inexistente')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Batch not found.');
      });
  });
});
