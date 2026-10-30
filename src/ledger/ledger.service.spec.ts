import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { BanksService } from '../banks/banks.service';
import { ExpenseEntity } from './expense.entity';
import { LedgerService, resolveRange, toEntity } from './ledger.service';

const NOW = new Date('2026-10-15T12:00:00Z');

const row = (
  createdAt: string,
  amount: number,
  extra: Partial<ExpenseEntity> = {},
) =>
  ({
    createdAt: new Date(createdAt),
    amount,
    currency: 'USD',
    category: 'Software',
    counterparty: 'AWS',
    ...extra,
  }) as ExpenseEntity;

const setup = (rows: ExpenseEntity[] = [], count = 0) => {
  const repo = {
    find: jest.fn(() => Promise.resolve(rows)),
    count: jest.fn(() => Promise.resolve(count)),
    upsert: jest.fn(() => Promise.resolve()),
  };
  const banks = {
    balances: jest.fn(() =>
      Promise.resolve({
        items: [],
        totals: [{ currency: 'USD', available: 9000, current: 9000 }],
        errors: [],
      }),
    ),
    fanOut: jest.fn(),
  };
  const config = {
    get: (_k: string, d: unknown) => d,
  } as unknown as ConfigService;
  const svc = new LedgerService(
    repo as unknown as Repository<ExpenseEntity>,
    banks as unknown as BanksService,
    config,
  );
  return { svc, repo, banks };
};

describe('resolveRange', () => {
  it('treats a bare end date as end-of-day and defaults to the last 30 days', () => {
    expect(
      resolveRange({ start: '2026-10-01', end: '2026-10-02' }).to.toISOString(),
    ).toBe('2026-10-02T23:59:59.999Z');
    const { from, to } = resolveRange({}, NOW);
    expect(to).toEqual(NOW);
    expect(from.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });
});

describe('toEntity', () => {
  it('namespaces ids per bank and clamps long strings', () => {
    const e = toEntity({
      bank: 'mercury',
      id: 'tx1',
      accountId: 'a',
      amount: 5,
      currency: 'USD',
      counterparty: 'x'.repeat(300),
      description: null,
      category: null,
      cardId: null,
      status: 'sent',
      kind: 'other',
      createdAt: '2026-10-01T00:00:00Z',
      postedAt: null,
    });
    expect(e.id).toBe('mercury:tx1');
    expect(e.counterparty).toHaveLength(255);
    expect(e.postedAt).toBeNull();
  });
});

describe('LedgerService reports', () => {
  it('burn fills every month per currency, zero where nothing was spent', async () => {
    const { svc } = setup([
      row('2026-08-03T00:00:00Z', 100),
      row('2026-08-20T00:00:00Z', 0.5),
      row('2026-10-01T00:00:00Z', 7),
    ]);
    expect(await svc.burn(3, NOW)).toEqual([
      { month: '2026-08', currency: 'USD', amount: 100.5 },
      { month: '2026-09', currency: 'USD', amount: 0 },
      { month: '2026-10', currency: 'USD', amount: 7 },
    ]);
  });

  it('runway divides live balance by the avg of the last 3 complete months', async () => {
    const { svc, repo } = setup([
      row('2026-07-10T00:00:00Z', 1000),
      row('2026-08-10T00:00:00Z', 1000),
      row('2026-09-10T00:00:00Z', 1000),
    ]);
    const out = await svc.runway(NOW);
    expect(out.items).toEqual([
      {
        currency: 'USD',
        available: 9000,
        avgMonthlyBurn: 1000,
        runwayMonths: 9,
      },
    ]);
    // window is Jul 1 → Sep 30, i.e. excludes the current partial month
    const where = (
      repo.find.mock.calls[0] as unknown as [
        { where: { createdAt: { value: Date[] } } },
      ]
    )[0].where;
    expect(where.createdAt.value.map((d) => d.toISOString())).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-09-30T23:59:59.999Z',
    ]);
  });

  it('runway is null when there is no burn', async () => {
    expect((await setup([]).svc.runway(NOW)).items[0].runwayMonths).toBeNull();
  });

  it('spend groups, labels missing keys and sorts by amount', async () => {
    const { svc } = setup([
      row('2026-10-01T00:00:00Z', 5),
      row('2026-10-02T00:00:00Z', 50, { category: null }),
      row('2026-10-03T00:00:00Z', 1),
    ]);
    expect(await svc.spend('category', {})).toEqual([
      { key: '(none)', currency: 'USD', amount: 50, count: 1 },
      { key: 'Software', currency: 'USD', amount: 6, count: 2 },
    ]);
  });
});

describe('LedgerService sync', () => {
  const expense = {
    bank: 'mercury',
    id: 't',
    accountId: 'a',
    amount: 1,
    currency: 'USD',
    counterparty: 'x',
    description: null,
    category: null,
    cardId: null,
    status: 'sent',
    kind: 'other',
    createdAt: '2026-10-01T00:00:00Z',
    postedAt: null,
  };

  it('backfills on an empty table, upserts idempotently and returns bank errors', async () => {
    const { svc, repo, banks } = setup([], 0);
    banks.fanOut.mockResolvedValue({
      items: [expense],
      errors: [{ bank: 'b', message: 'down' }],
    });
    const out = await svc.sync();
    expect(repo.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'mercury:t' })],
      ['id'],
    );
    expect(out).toMatchObject({ synced: 1, errors: [{ bank: 'b' }] });
    expect(Date.now() - new Date(out.start).getTime()).toBeGreaterThan(
      364 * 86_400_000,
    );
  });

  it('alerts on money out to counterparties never seen before, not on backfill', async () => {
    const { svc, repo, banks } = setup([], 10);
    repo.find.mockResolvedValueOnce([{ counterparty: 'AWS' } as ExpenseEntity]);
    banks.fanOut.mockResolvedValue({
      items: [
        { ...expense, id: 'a', counterparty: 'AWS' },
        { ...expense, id: 'b', counterparty: 'Shady LLC' },
      ],
      errors: [],
    });
    expect((await svc.sync()).newCounterparties).toBe(1);

    const empty = setup([], 0);
    empty.banks.fanOut.mockResolvedValue({ items: [expense], errors: [] });
    expect((await empty.svc.sync()).newCounterparties).toBe(0);
    expect(empty.repo.find).not.toHaveBeenCalled();
  });

  it('uses the shorter lookback once data exists, and refuses overlapping runs', async () => {
    const { svc, banks } = setup([], 10);
    let release!: () => void;
    banks.fanOut.mockReturnValue(
      new Promise((r) => (release = () => r({ items: [], errors: [] }))),
    );
    const first = svc.sync();
    await expect(svc.sync()).rejects.toBeInstanceOf(ConflictException);
    release();
    const out = await first;
    expect(Date.now() - new Date(out.start).getTime()).toBeLessThan(
      31 * 86_400_000,
    );
  });
});
