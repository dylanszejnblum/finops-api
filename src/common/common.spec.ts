import { toCsv } from './csv';
import { sumMoney, totalsByCurrency } from './money';
import { TtlCache } from './ttl-cache';

describe('money', () => {
  it('sums without float drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([])).toBe(0);
  });

  it('totals per currency', () => {
    const rows = [
      { currency: 'USD', amount: 1.1 },
      { currency: 'USD', amount: 2.2 },
      { currency: 'ARS', amount: 5 },
    ];
    expect(totalsByCurrency(rows, ['amount'])).toEqual([
      { currency: 'USD', amount: 3.3 },
      { currency: 'ARS', amount: 5 },
    ]);
  });
});

describe('toCsv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const csv = toCsv(
      [
        { a: 'plain', b: 'has,comma' },
        { a: 'say "hi"', b: '=HYPERLINK("x")' },
        { a: null, b: -5 },
      ],
      ['a', 'b'],
    );
    expect(csv).toBe(
      'a,b\r\nplain,"has,comma"\r\n"say ""hi""","\'=HYPERLINK(""x"")"\r\n,\'-5\r\n',
    );
  });
});

describe('TtlCache', () => {
  it('dedupes within the ttl and reloads after', async () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const load = () => Promise.resolve(++calls);
    expect(
      await Promise.all([cache.get('k', load), cache.get('k', load)]),
    ).toEqual([1, 1]);
    jest.advanceTimersByTime(1001);
    expect(await cache.get('k', load)).toBe(2);
    jest.useRealTimers();
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache<number>(60_000);
    await expect(
      cache.get('k', () => Promise.reject(new Error('x'))),
    ).rejects.toThrow();
    await Promise.resolve();
    expect(await cache.get('k', () => Promise.resolve(7))).toBe(7);
  });

  it('ttl 0 disables caching', async () => {
    let calls = 0;
    const cache = new TtlCache<number>(0);
    await cache.get('k', () => Promise.resolve(++calls));
    await cache.get('k', () => Promise.resolve(++calls));
    expect(calls).toBe(2);
  });
});
