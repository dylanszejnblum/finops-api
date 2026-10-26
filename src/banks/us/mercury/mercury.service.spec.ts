import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MercuryService } from './mercury.service';

const svc = (env: Record<string, string>) =>
  new MercuryService({
    get: (k: string, d?: string) => env[k] ?? d,
  } as unknown as ConfigService);

const tx = (amount: number) => ({
  id: `t${amount}`,
  amount,
  status: 'sent',
  kind: 'debitCardTransaction',
  counterpartyName: 'AWS',
  bankDescription: null,
  note: 'infra',
  mercuryCategory: 'Software',
  cardId: 'c1',
  createdAt: '2026-10-01T00:00:00Z',
  postedAt: null,
});

describe('MercuryService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false); // expected error logs are noise here
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns only outgoing transactions as positive expenses, read-only GET with bearer token', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ total: 2, transactions: [tx(-42.5), tx(100)] }),
        ),
      );
    const out = await svc({ MERCURY_API_TOKEN: 'secret-token:x' }).expenses(
      'acc',
      { start: '2026-10-01' },
    );

    expect(out).toEqual([
      expect.objectContaining({
        id: 't-42.5',
        amount: 42.5,
        accountId: 'acc',
        description: 'infra',
      }),
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://api.mercury.com/api/v1/account/acc/transactions?start=2026-10-01&limit=500',
    );
    expect(init.method).toBeUndefined(); // defaults to GET
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token:x',
    );
  });

  it('503s when Mercury is not configured', async () => {
    await expect(svc({}).balances()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  const respond = (body: unknown, status = 200) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const configured = () => svc({ MERCURY_API_TOKEN: 't' });

  it('maps accounts to normalized balances, preferring nickname', async () => {
    respond({
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          nickname: 'Ops',
          status: 'active',
          availableBalance: 10.5,
          currentBalance: 12,
        },
        {
          id: 'a2',
          name: 'Savings',
          nickname: null,
          status: 'active',
          availableBalance: 0,
          currentBalance: 0,
        },
      ],
      page: {},
    });
    const out = await configured().balances();
    expect(out).toEqual([
      {
        bank: 'mercury',
        country: 'US',
        accountId: 'a1',
        name: 'Ops',
        currency: 'USD',
        available: 10.5,
        current: 12,
        status: 'active',
      },
      expect.objectContaining({ accountId: 'a2', name: 'Savings' }),
    ]);
  });

  it('honours MERCURY_BASE_URL (sandbox)', async () => {
    const fetchMock = respond({
      id: 'a1',
      name: 'x',
      nickname: null,
      status: 'active',
      availableBalance: 1,
      currentBalance: 1,
    });
    await svc({
      MERCURY_API_TOKEN: 't',
      MERCURY_BASE_URL: 'https://api-sandbox.mercury.com/api/v1',
    }).balance('a1');
    expect((fetchMock.mock.calls[0][0] as URL).toString()).toBe(
      'https://api-sandbox.mercury.com/api/v1/account/a1',
    );
  });

  it('maps Mercury 404 to NotFound', async () => {
    respond({ error: 'nope' }, 404);
    await expect(configured().balance('a1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps Mercury 5xx/401 to BadGateway without leaking the body', async () => {
    for (const status of [401, 500]) {
      respond({ secret: 'leak' }, status);
      const err = await configured()
        .balances()
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect(
        JSON.stringify((err as BadGatewayException).getResponse()),
      ).not.toContain('leak');
    }
  });

  it('maps network failures/timeouts to BadGateway', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(configured().balances()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('excludes zero-amount transactions from expenses', async () => {
    respond({ total: 1, transactions: [tx(0)] });
    expect(await configured().expenses('acc', {})).toEqual([]);
  });

  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body)));
  const account = (id: string) => ({
    id,
    name: id,
    nickname: null,
    status: 'active',
    availableBalance: 1,
    currentBalance: 1,
  });

  it('allExpenses walks every account and every transaction page', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) => {
        const url = new URL((input as URL).toString());
        if (url.pathname.endsWith('/accounts'))
          return json({ accounts: [account('a1'), account('a2')], page: {} });
        const offset = Number(url.searchParams.get('offset'));
        const n =
          url.pathname.includes('a1') && offset === 0
            ? 1000
            : url.pathname.includes('a1')
              ? 3
              : 0;
        return json({
          total: 0,
          transactions: Array.from({ length: n }, (_, i) => tx(-(i + 1))),
        });
      });
    const out = await configured().allExpenses({ start: '2026-01-01' });
    expect(out).toHaveLength(1003);
    const txCalls = fetchMock.mock.calls
      .map(([u]) => (u as URL).toString())
      .filter((u) => u.includes('/transactions'));
    expect(txCalls).toEqual([
      expect.stringContaining(
        '/account/a1/transactions?start=2026-01-01&limit=1000&offset=0',
      ),
      expect.stringContaining(
        '/account/a1/transactions?start=2026-01-01&limit=1000&offset=1000',
      ),
      expect.stringContaining(
        '/account/a2/transactions?start=2026-01-01&limit=1000&offset=0',
      ),
    ]);
  });

  it('follows account pages via page.nextPage', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => account(`p1-${i}`));
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() =>
        json({ accounts: full, page: { nextPage: 'cursor' } }),
      )
      .mockImplementationOnce(() =>
        json({ accounts: [account('last')], page: {} }),
      );
    expect(await configured().balances()).toHaveLength(1001);
    expect(
      (fetchMock.mock.calls[1][0] as URL).searchParams.get('start_after'),
    ).toBe('cursor');
  });

  it('caches balances for BALANCE_CACHE_SECONDS, and 0 disables it', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => json({ accounts: [account('a1')], page: {} }));
    const cached = configured();
    await cached.balances();
    await cached.balances();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const uncached = svc({
      MERCURY_API_TOKEN: 't',
      BALANCE_CACHE_SECONDS: '0',
    });
    await uncached.balances();
    await uncached.balances();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
