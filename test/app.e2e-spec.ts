import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

// Runs against whatever the environment provides:
//   always            → auth, validation, health
//   MERCURY_API_TOKEN → live calls (point MERCURY_BASE_URL at the sandbox)
//   DATABASE_URL      → migrations, scoped keys, sync, reports
// (env defaults live in test/e2e-env.ts)

const ADMIN = process.env.API_KEYS!.split(',')[0].trim();
const hasMercury = !!process.env.MERCURY_API_TOKEN;
const hasDb = !!process.env.DATABASE_URL;
const itIf = (cond: boolean) => (cond ? it : it.skip);

describe('FinOps API (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(() => app?.close());

  it('serves health publicly with a request id', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: hasDb ? 'up' : 'disabled' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes a safe caller request id and replaces an unsafe one', async () => {
    expect(
      (await http().get('/health').set('x-request-id', 'abc-123')).headers[
        'x-request-id'
      ],
    ).toBe('abc-123');
    expect(
      (await http().get('/health').set('x-request-id', 'bad id <x>')).headers[
        'x-request-id'
      ],
    ).not.toContain(' ');
  });

  it('rejects missing and wrong keys', async () => {
    await http().get('/v1/balances').expect(401);
    await http().get('/v1/balances').set('x-api-key', 'nope').expect(401);
  });

  it('validates input', async () => {
    await http()
      .get('/v1/us/mercury/accounts/not-a-uuid/expenses')
      .set('x-api-key', ADMIN)
      .expect(400);
    await http()
      .get('/v1/expenses?start=yesterday')
      .set('x-api-key', ADMIN)
      .expect(400);
  });

  it('publishes the OpenAPI document', async () => {
    const { body } = await http().get('/docs-json').expect(200);
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/v1/balances', '/v1/us/mercury/balances']),
    );
  });

  itIf(!hasMercury)('returns 503 for an unconfigured bank', async () => {
    await http()
      .get('/v1/us/mercury/balances')
      .set('x-api-key', ADMIN)
      .expect(503);
  });

  itIf(hasMercury)(
    'reads live balances and expenses from Mercury',
    async () => {
      const { body } = await http()
        .get('/v1/balances')
        .set('x-api-key', ADMIN)
        .expect(200);
      expect(body.errors).toEqual([]);
      expect(body.items.length).toBeGreaterThan(0);
      const accountId = body.items[0].accountId as string;
      await http()
        .get(`/v1/us/mercury/accounts/${accountId}/balance`)
        .set('x-api-key', ADMIN)
        .expect(200);
      await http()
        .get(`/v1/us/mercury/accounts/${accountId}/expenses`)
        .set('x-api-key', ADMIN)
        .expect(200);
      await http().get('/v1/expenses').set('x-api-key', ADMIN).expect(200);
    },
  );

  itIf(!hasDb)('does not expose DB routes without a DB', async () => {
    await http().get('/v1/reports/burn').set('x-api-key', ADMIN).expect(404);
  });

  itIf(hasDb)('issues scoped keys, enforces scopes, revokes', async () => {
    const { body: created } = await http()
      .post('/v1/admin/api-keys')
      .set('x-api-key', ADMIN)
      .send({ name: 'e2e-reports', scopes: ['reports'] })
      .expect(201);
    expect(created.key).toMatch(/^fo_/);

    await http()
      .get('/v1/reports/burn?months=2')
      .set('x-api-key', created.key)
      .expect(200);
    await http().get('/v1/balances').set('x-api-key', created.key).expect(403);
    await http()
      .post('/v1/admin/api-keys')
      .set('x-api-key', created.key)
      .send({ name: 'x', scopes: ['admin'] })
      .expect(403);

    const { body: list } = await http()
      .get('/v1/admin/api-keys')
      .set('x-api-key', ADMIN)
      .expect(200);
    expect(
      list.find((k: { id: string }) => k.id === created.id),
    ).not.toHaveProperty('hash');

    await http()
      .delete(`/v1/admin/api-keys/${created.id}`)
      .set('x-api-key', ADMIN)
      .expect(204);
    await http()
      .get('/v1/reports/burn')
      .set('x-api-key', created.key)
      .expect(401);
  });

  itIf(hasDb)('syncs and serves reports + CSV', async () => {
    const { body: sync } = await http()
      .post('/v1/ledger/sync')
      .set('x-api-key', ADMIN)
      .expect(201);
    expect(sync.synced).toBeGreaterThanOrEqual(0);
    await http()
      .get('/v1/reports/spend?groupBy=counterparty')
      .set('x-api-key', ADMIN)
      .expect(200);
    await http().get('/v1/reports/runway').set('x-api-key', ADMIN).expect(200);
    const csv = await http()
      .get('/v1/reports/expenses.csv')
      .set('x-api-key', ADMIN)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe(
      'createdAt,postedAt,bank,accountId,externalId,amount,currency,counterparty,description,category,cardId,status,kind',
    );
  });
});
