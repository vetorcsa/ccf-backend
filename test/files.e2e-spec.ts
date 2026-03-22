import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Files (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const adminEmail = 'admin@example.com';
  const adminPassword = '123456';
  const uploadDir = resolve(process.cwd(), 'uploads', 'xml');
  const maxUploadSizeBytes = Number(
    process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 5 * 1024 * 1024,
  );

  const cleanUploads = () => {
    rmSync(uploadDir, { recursive: true, force: true });
  };

  const seedAdminUser = async () => {
    const passwordHash = await hash(adminPassword, 10);

    await prisma.user.upsert({
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
    cleanUploads();
    await prisma.file.deleteMany();
    await seedAdminUser();
  });

  afterAll(async () => {
    cleanUploads();
    await prisma.file.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /files/upload aceita XML válido', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<root><ok>true</ok></root>'), {
        filename: 'valid.xml',
        contentType: 'application/xml',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toEqual(expect.any(String));
        expect(body.originalName).toBe('valid.xml');
        expect(body.mimeType).toBe('application/xml');
        expect(body.size).toBeGreaterThan(0);
        expect(body.status).toBe('RECEIVED');
        expect(body).not.toHaveProperty('path');
        expect(body.uploadedBy).toEqual({
          id: expect.any(String),
          name: 'Admin',
          email: adminEmail,
        });
      });
  });

  it('POST /files/upload rejeita arquivo não XML', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('plain text'), {
        filename: 'invalid.txt',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain('Only XML files are allowed');
      });
  });

  it('POST /files/upload rejeita XML com MIME type inválido', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<root/>'), {
        filename: 'invalid-mime.xml',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe(
          'Invalid MIME type. Use application/xml or text/xml.',
        );
      });
  });

  it('POST /files/upload rejeita arquivo acima do limite', async () => {
    const token = await loginAndGetToken();
    const tooLargeBuffer = Buffer.alloc(maxUploadSizeBytes + 1, 'a');

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', tooLargeBuffer, {
        filename: 'too-large.xml',
        contentType: 'application/xml',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain(
          `File is too large. Maximum size is ${maxUploadSizeBytes} bytes.`,
        );
      });
  });

  it('GET /files lista arquivos com paginação e filtros', async () => {
    const token = await loginAndGetToken();
    const dateFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dateTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<list>1</list>'), {
        filename: 'list-first.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<list>2</list>'), {
        filename: 'list-target.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/files')
      .query({
        page: 1,
        pageSize: 1,
        search: 'target',
        dateFrom,
        dateTo,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(1);
        expect(body.total).toBe(1);
        expect(body.totalPages).toBe(1);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBe(1);
        expect(body.data[0].originalName).toBe('list-target.xml');
        expect(body.data[0].status).toBe('RECEIVED');
        expect(body.data[0]).not.toHaveProperty('path');
        expect(body.data[0].uploadedBy).toEqual({
          id: expect.any(String),
          name: 'Admin',
          email: adminEmail,
        });
      });
  });

  it('GET /files/:id retorna detalhes públicos do arquivo', async () => {
    const token = await loginAndGetToken();

    const uploadResponse = await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<detail>ok</detail>'), {
        filename: 'detail.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    const fileId = uploadResponse.body.id as string;

    await request(app.getHttpServer())
      .get(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(fileId);
        expect(body.originalName).toBe('detail.xml');
        expect(body.status).toBe('RECEIVED');
        expect(body).not.toHaveProperty('path');
        expect(body.uploadedBy).toEqual({
          id: expect.any(String),
          name: 'Admin',
          email: adminEmail,
        });
      });
  });

  it('GET /files/:id/analysis retorna analise real de um XML salvo', async () => {
    const token = await loginAndGetToken();
    const nfeXmlBuffer = readFileSync(
      resolve(process.cwd(), 'http', 'XML', 'file1.xml'),
    );

    const uploadResponse = await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', nfeXmlBuffer, {
        filename: 'nfe-real.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    const fileId = uploadResponse.body.id as string;

    await request(app.getHttpServer())
      .get(`/files/${fileId}/analysis`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.file.id).toBe(fileId);
        expect(body.file.originalName).toBe('nfe-real.xml');

        expect(body.company).toMatchObject({
          corporateName: 'IRMAOS HOLZ LTDA EPP',
          cnpj: '00428508000195',
          ie: '0733257500120',
          uf: 'DF',
        });

        expect(body.document).toMatchObject({
          number: '81832',
          series: '1',
          model: '65',
          key: '53220100428508000195650010000818321000818330',
        });

        expect(body.document.items.length).toBe(4);
        expect(body.document.items[0]).toMatchObject({
          item: 1,
          ncm: '28289011',
          cfop: '5405',
        });

        expect(body.analysisSummary).toMatchObject({
          status: 'ATTENTION',
          totalItems: 4,
        });
        expect(body.analysisSummary.uniqueCfops).toEqual(
          expect.arrayContaining(['5405', '5102']),
        );

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
      });
  });

  it('GET /files/:id/download baixa arquivo por id', async () => {
    const token = await loginAndGetToken();

    const uploadResponse = await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<download>ok</download>'), {
        filename: 'download.xml',
        contentType: 'application/xml',
      })
      .expect(201);

    const fileId = uploadResponse.body.id as string;

    await request(app.getHttpServer())
      .get(`/files/${fileId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ headers, text }) => {
        expect(headers['content-disposition']).toContain('download.xml');
        expect(text).toContain('<download>ok</download>');
      });
  });

  it('GET /files/:id/download retorna erro para id inexistente', async () => {
    const token = await loginAndGetToken();

    await request(app.getHttpServer())
      .get('/files/id-inexistente/download')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('File not found.');
      });
  });
});
