import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Audits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminUserId: string;

  const adminEmail = 'admin@example.com';
  const adminPassword = '123456';

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
    await prisma.auditBatch.deleteMany();
    await prisma.audit.deleteMany();
    await prisma.batch.deleteMany();
    await seedAdminUser();
  });

  afterAll(async () => {
    await prisma.auditBatch.deleteMany();
    await prisma.audit.deleteMany();
    await prisma.batch.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /audits cria auditoria fiscal em DRAFT', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/audits')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Auditoria Supermercado A - Jan/2026',
        companyName: 'Supermercado A LTDA',
        cnpj: '00000000000100',
        uf: 'df',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: expect.any(String),
          name: 'Auditoria Supermercado A - Jan/2026',
          status: 'DRAFT',
          companyName: 'Supermercado A LTDA',
          cnpj: '00000000000100',
          uf: 'DF',
          totalBatches: 0,
          inboundBatches: 0,
          outboundBatches: 0,
        });
        expect(body.periodStart).toEqual(expect.any(String));
        expect(body.periodEnd).toEqual(expect.any(String));
        expect(body.createdBy).toEqual({
          id: adminUserId,
          name: 'Admin',
          email: adminEmail,
        });
      });
  });

  it('GET /audits exige autenticação', async () => {
    await request(app.getHttpServer()).get('/audits').expect(401);
  });

  it('GET /audits lista auditorias com paginação e filtros', async () => {
    const token = await loginAndGetToken();

    await prisma.audit.create({
      data: {
        name: 'Auditoria Mercado Central',
        companyName: 'Mercado Central LTDA',
        cnpj: '11111111000100',
        createdById: adminUserId,
      },
    });

    await prisma.audit.create({
      data: {
        name: 'Auditoria Padaria Norte',
        companyName: 'Padaria Norte LTDA',
        cnpj: '22222222000100',
        status: 'RECEIVED',
        createdById: adminUserId,
      },
    });

    await request(app.getHttpServer())
      .get('/audits')
      .query({
        page: 1,
        pageSize: 10,
        search: 'padaria',
        status: 'RECEIVED',
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
          name: 'Auditoria Padaria Norte',
          status: 'RECEIVED',
          totalBatches: 0,
        });
      });
  });

  it('POST /audits/:id/batches vincula batch existente como entrada e saída', async () => {
    const token = await loginAndGetToken();

    const audit = await prisma.audit.create({
      data: {
        name: 'Auditoria com lotes',
        createdById: adminUserId,
      },
    });

    const inboundBatch = await prisma.batch.create({
      data: {
        name: 'Entradas Janeiro',
        uploadedById: adminUserId,
        totalFiles: 10,
      },
    });

    const outboundBatch = await prisma.batch.create({
      data: {
        name: 'Saídas Janeiro',
        uploadedById: adminUserId,
        totalFiles: 12,
      },
    });

    await request(app.getHttpServer())
      .post(`/audits/${audit.id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId: inboundBatch.id,
        nature: 'INBOUND',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: expect.any(String),
          nature: 'INBOUND',
          batch: {
            id: inboundBatch.id,
            name: 'Entradas Janeiro',
            totalFiles: 10,
          },
        });
      });

    await request(app.getHttpServer())
      .post(`/audits/${audit.id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId: outboundBatch.id,
        nature: 'OUTBOUND',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/audits/${audit.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: audit.id,
          name: 'Auditoria com lotes',
          totalBatches: 2,
          inboundBatches: 1,
          outboundBatches: 1,
        });
        expect(body.batches.length).toBe(2);
      });
  });

  it('GET /audits/:id/batches lista batches vinculados', async () => {
    const token = await loginAndGetToken();

    const audit = await prisma.audit.create({
      data: {
        name: 'Auditoria documentos',
        createdById: adminUserId,
      },
    });

    const batch = await prisma.batch.create({
      data: {
        name: 'Lote Entrada',
        uploadedById: adminUserId,
      },
    });

    await prisma.auditBatch.create({
      data: {
        auditId: audit.id,
        batchId: batch.id,
        nature: 'INBOUND',
      },
    });

    await request(app.getHttpServer())
      .get(`/audits/${audit.id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.audit).toMatchObject({
          id: audit.id,
          totalBatches: 1,
          inboundBatches: 1,
          outboundBatches: 0,
        });
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({
          nature: 'INBOUND',
          batch: {
            id: batch.id,
            name: 'Lote Entrada',
          },
        });
      });
  });

  it('POST /audits/:id/batches rejeita vínculo duplicado', async () => {
    const token = await loginAndGetToken();

    const audit = await prisma.audit.create({
      data: {
        name: 'Auditoria duplicada',
        createdById: adminUserId,
      },
    });

    const batch = await prisma.batch.create({
      data: {
        name: 'Lote duplicado',
        uploadedById: adminUserId,
      },
    });

    await prisma.auditBatch.create({
      data: {
        auditId: audit.id,
        batchId: batch.id,
        nature: 'INBOUND',
      },
    });

    await request(app.getHttpServer())
      .post(`/audits/${audit.id}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId: batch.id,
        nature: 'OUTBOUND',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.message).toBe('Batch is already linked to this audit.');
      });
  });

  it('GET /audits/:id retorna 404 para auditoria inexistente', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .get('/audits/auditoria-inexistente')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Audit not found.');
      });
  });
});
